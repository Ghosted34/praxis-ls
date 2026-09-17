"use strict";
/**
 * Audit remediation PR 3 — "create anything": one write-execution contract.
 *
 * Three guarantees:
 *   1. Every ai_enabled write resolves to a runnable executor (completeness).
 *   2. The write actions the audit names — create client / supplier / lead /
 *      opportunity / purchase-request / purchase-order — run end-to-end through
 *      the real executor with the FULL actor and a correctly-shaped payload
 *      (closes C1/C2/C3, and proves the generic adapter now passes the actor).
 *   3. A ratchet: the set of writes that do NOT yet forward the actor equals the
 *      checked-in KNOWN_UNMIGRATED baseline exactly — so a new non-conforming
 *      write fails the build, and migrating one forces shrinking the baseline
 *      (closes C4 and keeps the contract from drifting back).
 */

// Mock every service whose write we drive end-to-end, so the executors run
// without a database. The manifests `require` these modules, so the mock is what
// the registrar wires. Each returns a plausible row for the entity_ref derivation.
jest.mock("../../src/modules/master/client_master/client_master.service", () => ({
  create: jest.fn(async () => ({ client_id: "cl-1" })),
}));
jest.mock("../../src/modules/master/supplier_master/supplier_master.service", () => ({
  create: jest.fn(async () => ({ supplier_id: "su-1" })),
  update: jest.fn(async () => ({ supplier_id: "su-1" })),
  list: jest.fn(),
  get: jest.fn(),
}));
jest.mock("../../src/modules/sales/lead/lead.service", () => ({
  create: jest.fn(async () => ({ lead_id: "le-1" })),
  transition: jest.fn(),
  convert: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
}));
jest.mock("../../src/modules/sales/opportunity/opportunity.service", () => ({
  create: jest.fn(async () => ({ opportunity_id: "op-1" })),
  moveStage: jest.fn(),
  win: jest.fn(),
  list: jest.fn(),
  board: jest.fn(),
  metrics: jest.fn(),
  get: jest.fn(),
}));
jest.mock("../../src/modules/procurement/purchase_request/purchase_request.service", () => ({
  createDraft: jest.fn(async () => ({ pr_id: "pr-1" })),
  transition: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
}));
jest.mock("../../src/modules/procurement/purchase_order/purchase_order.service", () => ({
  createDraft: jest.fn(async () => ({ po_id: "po-1" })),
}));

const clientMaster = require("../../src/modules/master/client_master/client_master.service");
const supplier = require("../../src/modules/master/supplier_master/supplier_master.service");
const lead = require("../../src/modules/sales/lead/lead.service");
const opportunity = require("../../src/modules/sales/opportunity/opportunity.service");
const purchaseRequest = require("../../src/modules/procurement/purchase_request/purchase_request.service");
const purchaseOrder = require("../../src/modules/procurement/purchase_order/purchase_order.service");

const { buildCatalogue, buildExecutorMap } = require("../../src/services/ai/action-registrar");
const { classifyWrites, paramCount, KNOWN_UNMIGRATED } = require("../../src/services/ai/write-contract");

const ACTOR = { user_id: "u-actor", roles: ["ops"], full_name: "Ada" };
const run = (map, key, payload) => map[key]({ client: {}, user: ACTOR, payload });

describe("every ai_enabled write is executable (completeness)", () => {
  it("resolves an executor for each catalogued, enabled write", () => {
    const map = buildExecutorMap();
    for (const w of buildCatalogue().filter((r) => r.is_write && r.ai_enabled)) {
      expect(typeof map[w.action_key]).toBe("function");
    }
  });
});

describe("the named create actions run with the FULL actor and correct payload", () => {
  let map;
  beforeAll(() => { map = buildExecutorMap(); });
  beforeEach(() => jest.clearAllMocks());

  it("create_client (vetted) → { data, actor: user }", async () => {
    await run(map, "create_client", { name: "Acme", client_type: "BOTH" });
    expect(clientMaster.create).toHaveBeenCalledWith({}, { data: { name: "Acme", client_type: "BOTH" }, actor: ACTOR });
  });

  it("create_supplier (C1: was a bare ref → data undefined) now passes { data, actor }", async () => {
    const payload = { name: "MoMo Traders", country_code: "CM" };
    await run(map, "create_supplier", payload);
    expect(supplier.create).toHaveBeenCalledWith({}, { data: payload, actor: ACTOR });
  });

  it("create_lead (C2: actor was dropped) now forwards the actor", async () => {
    const payload = { company_name: "Lead Co" };
    await run(map, "create_lead", payload);
    expect(lead.create).toHaveBeenCalledWith({}, { data: payload, actor: ACTOR });
  });

  it("create_opportunity (C2: actor was dropped) now forwards the actor", async () => {
    const payload = { name: "Big deal", amount: 5000 };
    await run(map, "create_opportunity", payload);
    expect(opportunity.create).toHaveBeenCalledWith({}, { data: payload, actor: ACTOR });
  });

  it("create_purchase_request (C3: snake→camel mismatch) maps fields and forwards the actor", async () => {
    await run(map, "create_purchase_request", {
      requested_by: "emp-1", scope_id: "sc-1", department: "Ops", justification: "spares",
      lines: [{ dictionary_item_id: "di-1", qty: 2 }],
    });
    expect(purchaseRequest.createDraft).toHaveBeenCalledWith({}, {
      requestedBy: "emp-1", scopeId: "sc-1", department: "Ops", justification: "spares",
      lines: [{ dictionary_item_id: "di-1", qty: 2 }], actor: ACTOR,
    });
  });

  it("draft_purchase_order (vetted) still runs with the actor", async () => {
    await run(map, "draft_purchase_order", { supplier_id: "su-1", items: [] });
    expect(purchaseOrder.createDraft).toHaveBeenCalledTimes(1);
    expect(purchaseOrder.createDraft.mock.calls[0][1].actor).toBe(ACTOR);
  });
});

describe("write-contract ratchet (audit C4)", () => {
  it("paramCount reads arrow and function forms", () => {
    expect(paramCount((c, p, actor) => actor)).toBe(3);
    expect(paramCount((c, p) => p)).toBe(2);
    expect(paramCount(function f(client, { data, actor = {} }) { return actor && data; })).toBe(2);
  });

  it("no NEW non-conforming write: nonConforming ⊆ KNOWN_UNMIGRATED", () => {
    const { nonConforming } = classifyWrites();
    const baseline = new Set(KNOWN_UNMIGRATED);
    const strays = nonConforming.filter((k) => !baseline.has(k));
    // A stray means a write does not forward the actor and is not grandfathered.
    // Fix it — make its manifest a 3-arg wrapper `(c, p, actor) => svc(c, { …, actor })`.
    expect(strays).toEqual([]);
  });

  it("baseline is not stale: every KNOWN_UNMIGRATED entry is still non-conforming", () => {
    const { nonConforming } = classifyWrites();
    const live = new Set(nonConforming);
    const migratedButListed = KNOWN_UNMIGRATED.filter((k) => !live.has(k));
    // These were migrated (or removed) but left in the baseline — delete them from
    // src/services/ai/write-contract-baseline.json so the backlog only shrinks.
    expect(migratedButListed).toEqual([]);
  });
});
