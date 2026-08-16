"use strict";

/**
 * F10 — partnership / vendor intake, and the draft supplier an approval opens.
 * doc/SALES_CRM_FEATURES.md#F10.
 *
 * Four things are worth a test here, and they are the four claims the feature
 * makes that a reader would otherwise have to take on trust:
 *
 *   1. The KPI tiles partition the register. Both of them — by status and by
 *      type — and the fold refuses to answer when either stops adding up.
 *   2. Approving is reachable only from IN_REVIEW, and rejecting demands a
 *      reason. The legacy accepts any status by POST with neither.
 *   3. Approving a vendor opens exactly one DRAFT supplier: not two on a second
 *      click, and not a duplicate of one that already exists under that name.
 *      An agency partnership opens one only when the approver asks.
 *   4. A DRAFT supplier cannot be put on a purchase order. That is the other
 *      half of "the gate is verification, not re-typing" — without it the
 *      correction this feature makes to the legacy would be a regression.
 *
 * DB-free: the repo is mocked at its boundary (its pure helpers are kept real),
 * and so are the vault, storage, numbering and event layers.
 */

const mockRPATH = "../../src/modules/sales/partnership_request/partnership_request.repo";

jest.mock("../../src/modules/sales/partnership_request/partnership_request.repo", () => {
  const actual = jest.requireActual(
    "../../src/modules/sales/partnership_request/partnership_request.repo",
  );
  return {
    ...actual,
    get: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    list: jest.fn(),
    findSupplierByNameNorm: jest.fn(),
    defaultEntityId: jest.fn(),
  };
});
jest.mock("../../src/modules/master/supplier_master/supplier_master.repo", () => ({
  insert: jest.fn(),
}));
jest.mock("../../src/modules/master/master_config/master_config.service", () => ({
  enforceRequired: jest.fn(async () => undefined),
}));
jest.mock("../../src/modules/master/_shared/party-write.service", () => ({
  normalizeName: ({ name, legal_name: legal }) =>
    String(legal || name || "").toLowerCase().replace(/\s+/g, " ").trim() || null,
  niuRccmMirror: () => ({}),
  validateRegistrations: () => undefined,
  writeChildren: jest.fn(async () => undefined),
}));
jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: jest.fn(async () => ({ number: "SUP-2026-0001" })),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: jest.fn(),
  archiveDocument: jest.fn(),
}));
jest.mock("../../src/services/storage.service", () => ({ delete: jest.fn() }));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => undefined),
  audit: jest.fn(async () => undefined),
}));

const rules = require("../../src/modules/sales/partnership_request/partnership_request.rules");
const repo = require(mockRPATH);
const supplierRepo = require("../../src/modules/master/supplier_master/supplier_master.repo");
const partyWrite = require("../../src/modules/master/_shared/party-write.service");
const service = require("../../src/modules/sales/partnership_request/partnership_request.service");
const po = require("../../src/modules/procurement/purchase_order/purchase_order.service");
const poRepo = require("../../src/modules/procurement/purchase_order/purchase_order.repo");

/** A client that records the transaction verbs and answers nothing else. */
function fakeClient() {
  const sql = [];
  return { sql, query: jest.fn(async (text) => { sql.push(String(text)); return { rows: [] }; }) };
}

const request = (over = {}) => ({
  partnership_request_id: "pr-1",
  company_name: "Atlas Freight Ltd",
  country_of_origin: "Cameroon",
  contact_name: "A. Mbeki",
  contact_title: "Director",
  contact_phone: "+237600000000",
  email: "a@atlas.example",
  proposal_type: "VENDOR_REGISTRATION",
  status: "IN_REVIEW",
  supplier_id: null,
  ...over,
});

beforeEach(() => {
  repo.update.mockImplementation(async (_c, id, fields) => ({ partnership_request_id: id, ...fields }));
  repo.defaultEntityId.mockResolvedValue("entity-1");
  repo.findSupplierByNameNorm.mockResolvedValue(null);
  supplierRepo.insert.mockImplementation(async (_c, data) => ({ supplier_id: "sup-1", ...data }));
});

/* ─── 1. the tiles ────────────────────────────────────────────────────────── */

describe("KPI tiles", () => {
  it("counts both partitions and derives the legacy's four tiles", () => {
    const kpi = rules.kpiFrom({
      statusRows: [
        { status: "NEW", c: 3 },
        { status: "IN_REVIEW", c: 2 },
        { status: "APPROVED", c: 4 },
        { status: "REJECTED", c: 1 },
      ],
      typeRows: [
        { proposal_type: "AGENCY_PARTNERSHIP", c: 6 },
        { proposal_type: "VENDOR_REGISTRATION", c: 4 },
      ],
    });
    expect(kpi.TOTAL).toBe(10);
    // The tile the legacy gets wrong: its list.php counts NEW + 'UNDER_REVIEW',
    // a string its own update.php never writes, so it reports 3 where the
    // answer is 5.
    expect(kpi.PENDING).toBe(5);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  it("shows an unrecognised status rather than dropping it", () => {
    const kpi = rules.kpiFrom({
      statusRows: [{ status: "NEW", c: 1 }, { status: "LEGACY_UNDER_REVIEW", c: 2 }],
      typeRows: [{ proposal_type: "AGENCY_PARTNERSHIP", c: 3 }],
    });
    expect(kpi.OTHER_STATUS).toBe(2);
    expect(kpi.TOTAL).toBe(3);
    expect(rules.assertPartitions(kpi)).toBe(true);
  });

  it("throws when a partition stops adding up", () => {
    const kpi = rules.kpiFrom({
      statusRows: [{ status: "NEW", c: 5 }],
      typeRows: [{ proposal_type: "AGENCY_PARTNERSHIP", c: 2 }],
    });
    expect(() => rules.assertPartitions(kpi)).toThrow(/belongs to no tile/);
  });
});

/* ─── 2. the lifecycle ────────────────────────────────────────────────────── */

describe("lifecycle", () => {
  it("refuses NEW -> APPROVED: a decision that opens a supplier needs a review first", () => {
    expect(() => rules.assertTransition("NEW", "APPROVED")).toThrow(/Cannot move/);
    expect(rules.assertTransition("IN_REVIEW", "APPROVED")).toBe(true);
  });

  it("lets a rejected application be re-opened, and an approved one not", () => {
    expect(rules.assertTransition("REJECTED", "IN_REVIEW")).toBe(true);
    expect(() => rules.assertTransition("APPROVED", "IN_REVIEW")).toThrow();
  });

  it("refuses to reject without a reason, and clears it when re-opening", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request({ status: "IN_REVIEW" }));
    await expect(service.reject(c, { id: "pr-1", reason: "   ", actor: {} }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    repo.get.mockResolvedValue(request({ status: "REJECTED", decision_reason: "no memberships" }));
    await service.transition(c, { id: "pr-1", to: "IN_REVIEW", actor: {} });
    expect(repo.update).toHaveBeenLastCalledWith(c, "pr-1", expect.objectContaining({
      status: "IN_REVIEW", decision_reason: null, reviewed_at: null,
    }));
  });

  it("will not approve through the generic transition endpoint", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request());
    await expect(service.transition(c, { id: "pr-1", to: "APPROVED", actor: {} }))
      .rejects.toMatchObject({ code: "USE_APPROVE" });
  });
});

/* ─── 3. approval and the supplier ────────────────────────────────────────── */

describe("approval", () => {
  it("opens exactly one DRAFT supplier for a vendor registration", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request());
    const out = await service.approve(c, { id: "pr-1", actor: { user_id: "u1" } });

    expect(supplierRepo.insert).toHaveBeenCalledTimes(1);
    const written = supplierRepo.insert.mock.calls[0][1];
    expect(written.registration_status).toBe("DRAFT");
    expect(written.name).toBe("Atlas Freight Ltd");
    expect(written.ref).toBe("SUP-2026-0001");
    // "Cameroon" is not a country CODE. char(2) is not a place to guess.
    expect(written.country_code).toBeNull();
    expect(out.supplier.supplier_id).toBe("sup-1");
    expect(out.supplier_reused).toBe(false);
    // The applicant's contact went with it, so nobody re-keys it.
    expect(partyWrite.writeChildren).toHaveBeenCalledWith(c, expect.objectContaining({
      kind: "supplier",
      primary_contact: expect.objectContaining({ name: "A. Mbeki", title: "Director" }),
    }));
    expect(c.sql).toContain("COMMIT");
  });

  it("reuses an existing supplier of the same name instead of duplicating it", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request());
    repo.findSupplierByNameNorm.mockResolvedValue({ supplier_id: "sup-existing", name: "Atlas Freight Ltd" });

    const out = await service.approve(c, { id: "pr-1", actor: {} });
    expect(supplierRepo.insert).not.toHaveBeenCalled();
    expect(out.supplier_reused).toBe(true);
    expect(repo.update).toHaveBeenLastCalledWith(c, "pr-1", expect.objectContaining({ supplier_id: "sup-existing" }));
  });

  it("refuses a second approval of an application that already has one", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request({ status: "IN_REVIEW", supplier_id: "sup-1" }));
    await expect(service.approve(c, { id: "pr-1", actor: {} }))
      .rejects.toMatchObject({ code: "ALREADY_APPROVED" });
    expect(supplierRepo.insert).not.toHaveBeenCalled();
  });

  it("opens no supplier for an agency partnership unless the approver asks", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request({ proposal_type: "AGENCY_PARTNERSHIP" }));
    const quiet = await service.approve(c, { id: "pr-1", actor: {} });
    expect(quiet.supplier).toBeNull();
    expect(supplierRepo.insert).not.toHaveBeenCalled();

    repo.get.mockResolvedValue(request({ proposal_type: "AGENCY_PARTNERSHIP" }));
    const asked = await service.approve(c, { id: "pr-1", create_supplier: true, actor: {} });
    expect(asked.supplier.supplier_id).toBe("sup-1");
  });

  it("rolls back rather than leaving a supplier no application points at", async () => {
    const c = fakeClient();
    repo.get.mockResolvedValue(request());
    repo.update.mockRejectedValueOnce(new Error("update failed"));
    await expect(service.approve(c, { id: "pr-1", actor: {} })).rejects.toThrow("update failed");
    expect(c.sql).toContain("ROLLBACK");
    expect(c.sql).not.toContain("COMMIT");
  });
});

/* ─── 4. the gate that replaces the re-typing ─────────────────────────────── */

describe("a draft supplier buys nothing", () => {
  it("refuses a DRAFT supplier on a purchase order, and names it", async () => {
    const c = fakeClient();
    jest.spyOn(poRepo, "supplierRegistrationStatus")
      .mockResolvedValue({ registration_status: "DRAFT", name: "Atlas Freight Ltd" });
    await expect(po.assertSupplierUsable(c, "sup-1"))
      .rejects.toMatchObject({ code: "SUPPLIER_NOT_VERIFIED" });
  });

  it("passes a verified one, and a legacy row with no status at all", async () => {
    const c = fakeClient();
    const spy = jest.spyOn(poRepo, "supplierRegistrationStatus");
    spy.mockResolvedValue({ registration_status: "ACTIVE", name: "Atlas" });
    await expect(po.assertSupplierUsable(c, "sup-1")).resolves.toBeUndefined();
    spy.mockResolvedValue({ registration_status: null, name: "Old supplier" });
    await expect(po.assertSupplierUsable(c, "sup-2")).resolves.toBeUndefined();
  });
});

/* ─── the memberships, on the way in ──────────────────────────────────────── */

describe("network memberships", () => {
  const { normaliseMemberships } = jest.requireActual(mockRPATH);

  it("takes an array, a JSON string or the legacy's comma-separated text", () => {
    expect(normaliseMemberships(["WCA", "JCTrans"])).toEqual(["WCA", "JCTrans"]);
    expect(normaliseMemberships('["WCA","JCTrans"]')).toEqual(["WCA", "JCTrans"]);
    expect(normaliseMemberships("WCA, JCTrans")).toEqual(["WCA", "JCTrans"]);
    expect(normaliseMemberships(null)).toEqual([]);
  });

  it("de-duplicates case-insensitively and caps the list", () => {
    expect(normaliseMemberships("WCA, wca ,  WCA")).toEqual(["WCA"]);
    expect(normaliseMemberships(Array.from({ length: 60 }, (_, i) => `N${i}`)).length).toBe(25);
  });
});
