"use strict";

/**
 * Cash request disbursed in instalments (migration 10719).
 *
 * WHY THIS EXISTS. `cash_request_payment` shipped with the module in 0342,
 * gained a FK hardening in 0498 and a CHECK in 0497 — and nothing ever wrote a
 * row to it. `disburse` took no amount, issued one régie advance for the whole
 * request, and set the status straight to DISBURSED. A request the treasury
 * could only fund in two tranches read as fully disbursed the moment the first
 * franc moved.
 *
 * The state was NOT added on its own. `PARTIALLY_DISBURSED` was originally
 * proposed as "a CHECK change plus a NEXT entry", which would have produced a
 * state nothing can write — the same defect Landing A repaired on
 * `regie_advance`, where two totals were read by `openBalance` and written by
 * nobody. These tests pin the derivation that makes the state real.
 */

const fs = require("fs");
const path = require("path");
const {
  NEXT,
  assertTransition,
  disbursementState,
} = require("../../src/modules/costing/cash_request/cash_request.rules");

function expectCode(fn, code) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
}

describe("the status is DERIVED from what has been paid", () => {
  test("nothing paid is still APPROVED", () => {
    expect(disbursementState(1000, 0)).toBe("APPROVED");
  });

  test("part paid is PARTIALLY_DISBURSED", () => {
    expect(disbursementState(1000, 1)).toBe("PARTIALLY_DISBURSED");
    expect(disbursementState(1000, 999.99)).toBe("PARTIALLY_DISBURSED");
  });

  test("paid in full is DISBURSED", () => {
    expect(disbursementState(1000, 1000)).toBe("DISBURSED");
  });

  test("two instalments that sum to the request close it", () => {
    // The realistic case: 400 now, 600 a fortnight later.
    expect(disbursementState(1000, 400)).toBe("PARTIALLY_DISBURSED");
    expect(disbursementState(1000, 400 + 600)).toBe("DISBURSED");
  });

  test("over-payment is REFUSED, not clamped", () => {
    // The money has already left the treasury by the time this runs, so a
    // duplicated instalment or a typo'd amount must surface, not round away.
    // Mirrors regie.rules.recomputeState's OVER_RETIRED.
    const err = expectCode(
      () => disbursementState(1000, 1000.01),
      "OVER_DISBURSED",
    );
    expect(err.status).toBe(422);
    expectCode(() => disbursementState(1000, 2000), "OVER_DISBURSED");
  });

  test("float noise does not create a phantom balance", () => {
    // 0.1 + 0.2 === 0.30000000000000004. Without rounding, three instalments
    // that visibly sum to the request would leave it PARTIALLY_DISBURSED
    // forever and the advance could never be closed.
    expect(disbursementState(0.3, 0.1 + 0.2)).toBe("DISBURSED");
  });
});

describe("the lifecycle admits instalments", () => {
  test("APPROVED can go to either disbursed state", () => {
    expect(NEXT.APPROVED).toContain("PARTIALLY_DISBURSED");
    expect(NEXT.APPROVED).toContain("DISBURSED");
  });

  test("PARTIALLY_DISBURSED can take another instalment or close", () => {
    // Self-transition: the second of three instalments lands back here.
    expect(assertTransition("PARTIALLY_DISBURSED", "PARTIALLY_DISBURSED")).toBe(
      true,
    );
    expect(assertTransition("PARTIALLY_DISBURSED", "DISBURSED")).toBe(true);
  });

  test("a partly disbursed request cannot be justified or rejected", () => {
    // Justification retires the advance and closes the request; doing it with
    // cash still to be paid out would strand the remaining instalment.
    expectCode(
      () => assertTransition("PARTIALLY_DISBURSED", "JUSTIFIED"),
      "BAD_STATE",
    );
    // Rejecting after money has moved is not a refusal, it is a reversal, and
    // there is no reversal path here.
    expectCode(
      () => assertTransition("PARTIALLY_DISBURSED", "REJECTED"),
      "BAD_STATE",
    );
  });

  test("no route skips straight from APPROVED to JUSTIFIED", () => {
    expectCode(() => assertTransition("APPROVED", "JUSTIFIED"), "BAD_STATE");
  });

  test("JUSTIFIED is the one terminal state", () => {
    expect(NEXT.JUSTIFIED).toEqual([]);
  });

  /*
   * 12771 changed this deliberately. REJECTED used to be terminal, which is
   * WORSE than the legacy it replaced: `pr_save` accepted DRAFT and REJECTED,
   * and `pr_transition` SUBMIT accepted `from ∈ {DRAFT, REJECTED}`, so a
   * mistyped MoMo number cost a whole document and its reference. The one way
   * out is back to the author's desk — never forward.
   */
  test("a rejected request reopens to DRAFT, and to nothing else", () => {
    expect(NEXT.REJECTED).toEqual(["DRAFT"]);
    expect(assertTransition("REJECTED", "DRAFT")).toBe(true);
    expectCode(() => assertTransition("REJECTED", "SUBMITTED"), "BAD_STATE");
    expectCode(() => assertTransition("REJECTED", "APPROVED"), "BAD_STATE");
  });
});

describe("the schema backs the state", () => {
  const root = path.join(__dirname, "..", "..");
  const migration = fs.readFileSync(
    path.join(
      root,
      "migrations",
      "tenant",
      "10719_cash_request_partial_disbursement.sql",
    ),
    "utf8",
  );
  const seed = fs.readFileSync(
    path.join(
      root,
      "migrations",
      "seeds",
      "9097_seed_cash_request_partial_event.sql",
    ),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(
      root,
      "src",
      "modules",
      "costing",
      "cash_request",
      "cash_request.service.js",
    ),
    "utf8",
  );
  const repo = fs.readFileSync(
    path.join(
      root,
      "src",
      "modules",
      "costing",
      "cash_request",
      "cash_request.repo.js",
    ),
    "utf8",
  );

  test("the CHECK is widened, never narrowed", () => {
    const added = migration.slice(
      migration.indexOf("ADD CONSTRAINT cash_request_status_check"),
    );
    for (const st of [
      "DRAFT",
      "SUBMITTED",
      "APPROVED",
      "DISBURSED",
      "JUSTIFIED",
      "REJECTED",
    ]) {
      expect(added).toContain(`'${st}'`);
    }
    expect(added).toContain("'PARTIALLY_DISBURSED'");
  });

  test("each instalment's advance is linked from the PAYMENT row, uniquely", () => {
    // cash_request.regie_advance_id is a single uuid, so the per-instalment
    // link has to live on the child. UNIQUE stops two payments claiming one
    // advance.
    expect(migration).toMatch(
      /ALTER TABLE cash_request_payment[\s\S]*?regie_advance_id uuid REFERENCES regie_advance/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_request_payment_advance/,
    );
  });

  test("the emitted event key is seeded — an unseeded key is unroutable", () => {
    const events = require("../../src/modules/costing/cash_request/cash_request.events");
    expect(events.PARTIALLY_DISBURSED).toBe("cash_request.partially_disbursed");
    expect(seed).toContain("'cash_request.partially_disbursed'");
  });

  test("disbursed_amount is recomputed from the children, never incremented", () => {
    // An increment drifts the first time a payment is voided — 10717's rule.
    expect(service).toContain("repo.paymentsTotal(client, id)");
    expect(service).not.toMatch(/disbursed_amount:\s*[^,\n]*\+/);
    expect(repo).toContain("SUM(amount)");
  });

  test("the write is serialised with FOR UPDATE", () => {
    // Two concurrent instalments would otherwise both read the same total and
    // both derive PARTIALLY_DISBURSED, understating the cash issued.
    expect(repo).toMatch(
      /FROM cash_request WHERE cash_request_id = \$1 FOR UPDATE/,
    );
    expect(service).toContain("repo.getCRForUpdate(client, id)");
  });

  test("the backfill is idempotent and invents no payment rows", () => {
    const backfill = migration.slice(migration.indexOf("UPDATE cash_request"));
    expect(backfill).toContain("disbursed_amount = 0");
    // Synthesising a payment date and treasury account nobody recorded would be
    // fabrication; only the cache is seeded.
    expect(migration).not.toMatch(/INSERT INTO cash_request_payment/);
  });

  test("the migration is additive and declares its DOWN", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(migration).toMatch(/^-- DOWN/m);
    expect(migration).not.toMatch(
      /^\s*ALTER TABLE cash_request\s+DROP COLUMN/m,
    );
  });
});

describe("the AI can actually target a request", () => {
  // `zod` does not resolve without an npm install (no network in this
  // environment), so the schema is asserted from source rather than executed.
  const dir = path.join(
    __dirname,
    "..",
    "..",
    "src",
    "modules",
    "costing",
    "cash_request",
  );
  const ai = fs.readFileSync(path.join(dir, "cash_request.ai.js"), "utf8");
  const validator = fs.readFileSync(
    path.join(dir, "cash_request.validator.js"),
    "utf8",
  );

  test("disburse_cash_request carries cash_request_id — it did not before", () => {
    // The adapter passes its payload straight to the service, so the bare
    // `disburse` schema (which has no id) meant every AI disbursement arrived
    // with id: undefined and 404'd. Pre-existing; fixed alongside 10719.
    expect(ai).toContain("validator.schemas.aiDisburse");
    expect(ai).toContain("id: p.cash_request_id");
    const line = validator.split("\n").find((l) => l.includes("aiDisburse:"));
    expect(line).toBeDefined();
    expect(line).toContain("cash_request_id: z.string().uuid()");
  });

  test("an amount is optional on both schemas, and positive when given", () => {
    for (const key of ["disburse:", "aiDisburse:"]) {
      const line = validator.split("\n").find((l) => l.includes(key));
      expect(line).toContain("amount: z.number().positive().optional()");
    }
  });

  test("the manifest forwards the amount rather than dropping it", () => {
    // Passing the payload straight through would have silently ignored a
    // partial amount and paid the whole request.
    expect(ai).toMatch(/amount: p\.amount === undefined \? null : p\.amount/);
  });
});
