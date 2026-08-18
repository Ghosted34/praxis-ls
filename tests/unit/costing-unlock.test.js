"use strict";

/**
 * Costing unlock — the way out of APPROVED_LOCKED (migration 10718).
 *
 * WHY THIS EXISTS. `costing.setStatus` refuses any transition out of a locked
 * status before it looks at the target (costing.service.js:21, :69), and both
 * APPROVED_LOCKED and REJECTED are in that set. So an approved costing could
 * never be corrected — a wrong rate, a carrier credit, a line priced against
 * the wrong container all had the same non-remedy: raise a second costing that
 * silently competes with the first for the same dossier.
 *
 * The legacy system did NOT have this defect (api/costing/transition.php gates
 * REQUEST_UNLOCK / UNLOCK / DENY_UNLOCK), and régie's rules module explicitly
 * named it as the thing not to repeat. These tests pin the fix.
 *
 * THE PART THAT IS NOT IN THE LEGACY, AND MATTERS MOST: approving a costing
 * opens a FINAL invoice for its dossier (`ensureDraftForCosting`), and that
 * invoice can reach POSTED_LOCKED with a real `entry_id`. Reopening the costing
 * underneath a posted receivable would let the priced basis move while the
 * booked revenue stayed put. The guard against that is the bulk of this file.
 *
 * DB-free: the service runs against a stub client that answers the two queries
 * it makes (the costing row, the invoice probe), so the SQL and the branching
 * asserted here are the ones that run in production.
 */

const fs = require("fs");
const path = require("path");

// Same reason as regie-holder-scope: costing.service reaches the ledger, the
// workflow executor and the invoice module, which pull @praxis/shared, dotenv
// and pino — none resolvable without an npm install. `unlockTransition` uses
// none of them, and the factories stop the real modules ever loading.
jest.mock(
  "../../src/modules/finance/final_invoice/final_invoice.service",
  () => ({
    ensureDraftForCosting: jest.fn(),
  }),
);
jest.mock("../../src/services/documents/numbering.service", () => ({
  allocate: jest.fn(),
}));
jest.mock("../../src/services/workflow/executor", () => ({ start: jest.fn() }));
jest.mock("../../src/services/workflow/on-approved", () => ({
  register: jest.fn(),
}));
jest.mock("../../src/services/workflow/pending-guard", () => ({
  assertNoPendingChain: jest.fn(),
}));
jest.mock(
  "../../src/modules/operations/shipment_details/shipment_details.service",
  () => ({
    snapshotOnto: jest.fn(),
  }),
);
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn() },
}));

const service = require("../../src/modules/costing/costing/costing.service");
const events = require("../../src/modules/costing/costing/costing.events");

const ID = "11111111-1111-1111-1111-111111111111";
const DOSSIER = "22222222-2222-2222-2222-222222222222";
const ACTOR = { user_id: "33333333-3333-3333-3333-333333333333" };

/**
 * A client that answers the two reads `unlockTransition` performs and records
 * the UPDATE. `invoiceStatus` is what the final-invoice probe finds: null means
 * no non-DRAFT invoice exists (the probe returns no rows).
 */
function stubClient({
  status = "APPROVED_LOCKED",
  dossierId = DOSSIER,
  invoiceStatus = null,
} = {}) {
  const state = {
    row: { costing_id: ID, dossier_id: dossierId, status },
    updates: [],
    queries: [],
  };
  state.query = async (text, params) => {
    state.queries.push({ text, params });
    if (/FROM costing\b/i.test(text) && /WHERE/i.test(text))
      return { rows: [state.row] };
    if (/FROM invoice\b/i.test(text)) {
      return invoiceStatus
        ? {
            rows: [
              {
                invoice_id: "inv-1",
                doc_number: "FIN-2026-0007",
                status: invoiceStatus,
              },
            ],
          }
        : { rows: [] };
    }
    if (/^UPDATE costing/i.test(text.trim())) {
      state.updates.push({ text, params });
      return { rows: [{ ...state.row, status: "updated" }] };
    }
    return { rows: [] };
  };
  return state;
}

/** Assert an AppError by its `code` — the API contract the client switches on.
 *  A regex over the message would pass for the wrong error. */
async function expectCode(promise, code) {
  try {
    await promise;
  } catch (err) {
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
}

describe("the unlock state machine", () => {
  test("REQUEST_UNLOCK moves APPROVED_LOCKED → UNLOCK_REQUESTED", async () => {
    const c = stubClient({ status: "APPROVED_LOCKED" });
    await service.unlockTransition(c, {
      id: ID,
      action: "REQUEST_UNLOCK",
      reason: "Carrier issued a credit note",
      actor: ACTOR,
    });
    expect(c.updates).toHaveLength(1);
    expect(c.updates[0].params).toContain("UNLOCK_REQUESTED");
    // Attribution is required by chk_costing_unlock_requested_attributed.
    expect(c.updates[0].params).toContain("Carrier issued a credit note");
    expect(c.updates[0].params).toContain(ACTOR.user_id);
  });

  test("UNLOCK returns the costing to DRAFT — the only editable status", async () => {
    const c = stubClient({ status: "UNLOCK_REQUESTED" });
    await service.unlockTransition(c, {
      id: ID,
      action: "UNLOCK",
      actor: ACTOR,
    });
    expect(c.updates[0].params).toContain("DRAFT");
  });

  test("DENY_UNLOCK puts it back to APPROVED_LOCKED", async () => {
    const c = stubClient({ status: "UNLOCK_REQUESTED" });
    await service.unlockTransition(c, {
      id: ID,
      action: "DENY_UNLOCK",
      actor: ACTOR,
    });
    expect(c.updates[0].params).toContain("APPROVED_LOCKED");
  });

  test("each action refuses a costing in the wrong state", async () => {
    for (const [action, wrongState] of [
      ["REQUEST_UNLOCK", "DRAFT"],
      ["UNLOCK", "APPROVED_LOCKED"], // must be requested first
      ["DENY_UNLOCK", "APPROVED_LOCKED"],
    ]) {
      const c = stubClient({ status: wrongState });
      await expectCode(
        service.unlockTransition(c, { id: ID, action, actor: ACTOR }),
        "BAD_STATE",
      );
      expect(c.updates).toHaveLength(0);
    }
  });

  test("an unknown action is refused rather than defaulting to something", async () => {
    const c = stubClient();
    await expectCode(
      service.unlockTransition(c, {
        id: ID,
        action: "UNLOCK_EVERYTHING",
        actor: ACTOR,
      }),
      "BAD_ACTION",
    );
  });

  test("a missing costing is a 404, not a silent no-op", async () => {
    const c = stubClient();
    c.row = null;
    const orig = c.query;
    c.query = async (t, p) =>
      /FROM costing\b/i.test(t) ? { rows: [] } : orig(t, p);
    const err = await expectCode(
      service.unlockTransition(c, { id: ID, action: "UNLOCK", actor: ACTOR }),
      "NOT_FOUND",
    );
    expect(err.status).toBe(404);
  });

  test("REQUEST_UNLOCK demands a reason — it is the audit answer", async () => {
    const c = stubClient({ status: "APPROVED_LOCKED" });
    await expectCode(
      service.unlockTransition(c, {
        id: ID,
        action: "REQUEST_UNLOCK",
        actor: ACTOR,
      }),
      "REASON_REQUIRED",
    );
    // Whitespace is not a reason.
    await expectCode(
      service.unlockTransition(c, {
        id: ID,
        action: "REQUEST_UNLOCK",
        reason: "   ",
        actor: ACTOR,
      }),
      "REASON_REQUIRED",
    );
    expect(c.updates).toHaveLength(0);
  });

  test("the two decisions do NOT require a reason", async () => {
    for (const action of ["UNLOCK", "DENY_UNLOCK"]) {
      const c = stubClient({ status: "UNLOCK_REQUESTED" });
      await service.unlockTransition(c, { id: ID, action, actor: ACTOR });
      expect(c.updates).toHaveLength(1);
    }
  });
});

describe("a posted final invoice blocks the unlock", () => {
  // Approving a costing opens a FINAL invoice for its dossier. Once that
  // invoice leaves DRAFT the costing is settled history.
  test.each([
    "ISSUED_LOCKED",
    "APPROVED_LOCKED",
    "POSTED_LOCKED",
    "REVERSED",
    "CANCELLED",
  ])(
    "UNLOCK is refused while the final invoice is %s",
    async (invoiceStatus) => {
      const c = stubClient({ status: "UNLOCK_REQUESTED", invoiceStatus });
      const err = await expectCode(
        service.unlockTransition(c, { id: ID, action: "UNLOCK", actor: ACTOR }),
        "INVOICE_ISSUED",
      );
      expect(err.status).toBe(422);
      // The message names the offending document, so the user knows what to
      // reverse rather than being told "no".
      expect(err.message).toContain("FIN-2026-0007");
      expect(err.message).toContain(invoiceStatus);
      expect(c.updates).toHaveLength(0);
    },
  );

  test("a DRAFT final invoice does not block it — nothing is posted yet", async () => {
    // The probe filters `status <> 'DRAFT'` in SQL, so a draft returns no rows.
    const c = stubClient({ status: "UNLOCK_REQUESTED", invoiceStatus: null });
    await service.unlockTransition(c, {
      id: ID,
      action: "UNLOCK",
      actor: ACTOR,
    });
    expect(c.updates).toHaveLength(1);
  });

  test("the probe looks only at FINAL invoices for THIS dossier", async () => {
    const c = stubClient({ status: "UNLOCK_REQUESTED" });
    await service.unlockTransition(c, {
      id: ID,
      action: "UNLOCK",
      actor: ACTOR,
    });
    const probe = c.queries.find((q) => /FROM invoice/i.test(q.text));
    expect(probe).toBeDefined();
    expect(probe.text).toMatch(/type = 'FINAL'/);
    expect(probe.text).toMatch(/status <> 'DRAFT'/);
    expect(probe.params).toEqual([DOSSIER]);
  });

  test("a costing with no dossier skips the probe rather than failing", async () => {
    const c = stubClient({ status: "UNLOCK_REQUESTED", dossierId: null });
    await service.unlockTransition(c, {
      id: ID,
      action: "UNLOCK",
      actor: ACTOR,
    });
    expect(c.queries.find((q) => /FROM invoice/i.test(q.text))).toBeUndefined();
    expect(c.updates).toHaveLength(1);
  });

  test("REQUEST_UNLOCK is NOT blocked by a posted invoice — asking is harmless", async () => {
    // The invoice may well be reversed between the request and the decision;
    // refusing the request too would make that ordering impossible.
    const c = stubClient({
      status: "APPROVED_LOCKED",
      invoiceStatus: "POSTED_LOCKED",
    });
    await service.unlockTransition(c, {
      id: ID,
      action: "REQUEST_UNLOCK",
      reason: "wrong container type",
      actor: ACTOR,
    });
    expect(c.updates).toHaveLength(1);
    expect(c.queries.find((q) => /FROM invoice/i.test(q.text))).toBeUndefined();
  });
});

describe("the wiring around it", () => {
  const read = (p) =>
    fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");
  const routes = read("src/modules/costing/costing/costing.routes.js");
  const migration = read("migrations/tenant/10718_costing_unlock.sql");
  const seed = read("migrations/seeds/9096_seed_costing_unlock_events.sql");

  test("event keys are distinct per action, so a chain can bind to the grant alone", () => {
    expect(events.unlockEvent("REQUEST_UNLOCK")).toBe(
      "costing.unlock_requested",
    );
    expect(events.unlockEvent("UNLOCK")).toBe("costing.unlocked");
    expect(events.unlockEvent("DENY_UNLOCK")).toBe("costing.unlock_denied");
  });

  test("every emitted key is seeded — an unseeded key is unroutable (Landing A defect 2)", () => {
    for (const key of Object.values(events.UNLOCK_EVENT)) {
      expect(seed).toContain(`'${key}'`);
    }
  });

  test("only the grant is approvable", () => {
    const line = (k) => seed.split("\n").find((l) => l.includes(`'${k}'`));
    expect(line("costing.unlocked")).toMatch(/true\)?,?\s*$/);
    expect(line("costing.unlock_requested")).toMatch(/false,\s*false\)/);
    expect(line("costing.unlock_denied")).toMatch(/false,\s*false\)/);
  });

  test("asking is `edit`; deciding is `approve` + APPROVER", () => {
    expect(routes).toMatch(/REQUEST_UNLOCK:\s*"edit"/);
    expect(routes).toMatch(/UNLOCK:\s*"approve"/);
    expect(routes).toMatch(/DENY_UNLOCK:\s*"approve"/);
    // The SoD overlay applies to the decisions only — demanding APPROVER to
    // ASK would be the same bug as demanding `approve` to submit.
    expect(routes).toMatch(
      /UNLOCK_CAPABILITY\s*=\s*\{[^}]*UNLOCK:\s*"APPROVER"/,
    );
    expect(routes).not.toMatch(
      /UNLOCK_CAPABILITY\s*=\s*\{[^}]*REQUEST_UNLOCK:/,
    );
  });

  test("the RBAC middleware keys on `action`, not the default `to`", () => {
    // costing.routes.js has TWO transition endpoints; the unlock one carries a
    // different field name and would silently fall back to `approve` for every
    // action if the option were dropped.
    expect(routes).toMatch(/UNLOCK_ACTION,\s*\{\s*field:\s*"action"\s*\}/);
    expect(routes).toMatch(/UNLOCK_CAPABILITY,\s*\{\s*field:\s*"action"\s*\}/);
  });

  test("the CHECK is widened, never narrowed — no existing row can violate it", () => {
    const old = [
      "DRAFT",
      "SUBMITTED_FOR_VALIDATION",
      "SUBMITTED_FOR_APPROVAL",
      "APPROVED_LOCKED",
      "REJECTED",
    ];
    const added = migration.slice(
      migration.indexOf("ADD CONSTRAINT costing_status_check"),
    );
    for (const st of old) expect(added).toContain(`'${st}'`);
    expect(added).toContain("'UNLOCK_REQUESTED'");
  });

  test("the migration is additive and reversible-by-declaration", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(migration).not.toMatch(/^\s*ALTER TABLE costing\s+DROP COLUMN/m);
    expect(migration).toMatch(/^-- DOWN/m);
  });
});
