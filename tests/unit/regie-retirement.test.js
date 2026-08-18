"use strict";

/**
 * Régie d'avance — the retirement loop (KB §6.8, migration 10717).
 *
 * WHY THIS FILE EXISTS. `regie_advance.justified_amount` and `returned_amount`
 * were read by `openBalance` (regie.rules.js:14) and written by NOTHING in
 * `src/`. So `openBalance` was identically `amount`, 581 never cleared, and
 * three of the five states in the DB CHECK were unreachable. These tests pin
 * the behaviour that closes that loop.
 *
 * Everything here is pure — no DB, no network — following
 * `extra-charge-five-families-g16.test.js`. The ledger assertions are possible
 * without a database because a posting is correct iff Σ debits = Σ credits and
 * the accounts are the ones the KB names.
 */

const rules = require("../../src/modules/costing/regie/regie.rules");

// The account map as seed 9094 writes it. Restated independently of the source
// under test: if someone edits the fallbacks in regie.service.js, these still
// assert the KB's accounts.
const ACCOUNTS = {
  regie: "581",
  treasury: "5211",
  cash: "571",
  holder_receivable: "4211",
  dossier_mandant: "4731",
  write_off: "658",
};

const DOSSIER = "11111111-1111-1111-1111-111111111111";
const PROOF = "22222222-2222-2222-2222-222222222222";

/**
 * Assert an AppError with a specific `code`.
 *
 * The code is the API contract — it is what the client switches on and what the
 * HTTP layer surfaces — whereas the message is prose that may be reworded. A
 * regex over the message would pass for the WRONG error whenever two messages
 * happen to share a word, so these assert the code itself.
 */
function expectCode(fn, code) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe(code);
    expect(err.status).toBe(422);
    return err;
  }
  throw new Error(
    `expected an AppError with code ${code}, but nothing was thrown`,
  );
}

/** An advance as `issue()` writes it: 500,000 XAF, nothing retired yet. */
const freshAdvance = (over = {}) => ({
  regie_advance_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  amount: 500000,
  justified_amount: 0,
  returned_amount: 0,
  issued_on: "2026-08-01",
  policy_window_days: 7,
  state: "ISSUED",
  currency: "XAF",
  exchange_rate_to_xaf: 1,
  ...over,
});

describe("openBalance — what is still sitting in 581", () => {
  test("a fresh advance is entirely open", () => {
    expect(rules.openBalance(freshAdvance())).toBe(500000);
  });

  test("receipts and cash returns both reduce it", () => {
    // 300,000 spent (→ 4731) + 150,000 handed back (→ 571) leaves 50,000 in 581.
    const a = freshAdvance({
      justified_amount: 300000,
      returned_amount: 150000,
    });
    expect(rules.openBalance(a)).toBe(50000);
  });

  test("rounds to two decimals rather than accumulating float error", () => {
    const a = freshAdvance({
      amount: 100,
      justified_amount: 33.33,
      returned_amount: 33.33,
    });
    expect(rules.openBalance(a)).toBe(33.34);
  });
});

describe("totalsFrom — the cache is DERIVED from the child rows", () => {
  test("RECEIPT counts as justified; CASH_RETURN and WRITE_OFF as returned", () => {
    const totals = rules.totalsFrom([
      { kind: "RECEIPT", amount: 120000 },
      { kind: "RECEIPT", amount: 80000 },
      { kind: "CASH_RETURN", amount: 50000 },
      { kind: "WRITE_OFF", amount: 10000 },
    ]);
    expect(totals).toEqual({
      justified_amount: 200000,
      returned_amount: 60000,
    });
  });

  test("no retirements means zero, not NaN", () => {
    expect(rules.totalsFrom([])).toEqual({
      justified_amount: 0,
      returned_amount: 0,
    });
    expect(rules.totalsFrom(undefined)).toEqual({
      justified_amount: 0,
      returned_amount: 0,
    });
  });

  test("recomputing from the same children twice is stable (no drift)", () => {
    // The whole reason the totals are recomputed rather than incremented: run it
    // repeatedly and the answer must not move.
    const children = [
      { kind: "RECEIPT", amount: 111.11 },
      { kind: "CASH_RETURN", amount: 22.22 },
    ];
    expect(rules.totalsFrom(children)).toEqual(rules.totalsFrom(children));
    expect(rules.totalsFrom(children)).toEqual({
      justified_amount: 111.11,
      returned_amount: 22.22,
    });
  });
});

describe("recomputeState — the three states that used to be unreachable", () => {
  test("nothing retired stays ISSUED", () => {
    const a = freshAdvance();
    expect(
      rules.recomputeState(a, { justified_amount: 0, returned_amount: 0 }),
    ).toBe("ISSUED");
  });

  test("a partial receipt reaches PARTIALLY_JUSTIFIED", () => {
    const a = freshAdvance();
    expect(
      rules.recomputeState(a, { justified_amount: 200000, returned_amount: 0 }),
    ).toBe("PARTIALLY_JUSTIFIED");
  });

  test("receipts alone that exactly consume the advance reach JUSTIFIED", () => {
    const a = freshAdvance();
    expect(
      rules.recomputeState(a, { justified_amount: 500000, returned_amount: 0 }),
    ).toBe("JUSTIFIED");
  });

  test("receipts PLUS returned cash netting 581 to zero reach JUSTIFIED — KB step 4", () => {
    const a = freshAdvance();
    expect(
      rules.recomputeState(a, {
        justified_amount: 430000,
        returned_amount: 70000,
      }),
    ).toBe("JUSTIFIED");
  });

  test("over-retirement throws rather than reaching the DB constraint", () => {
    // 0497:137 already enforces justified + returned <= amount. Failing here
    // gives a 422 naming the overage instead of a raw constraint violation
    // surfacing from inside a transaction.
    const a = freshAdvance();
    expectCode(
      () =>
        rules.recomputeState(a, {
          justified_amount: 500000,
          returned_amount: 1,
        }),
      "OVER_RETIRED",
    );
  });

  test("a QUERIED advance is NOT silently lifted by a partial receipt", () => {
    // A query is a human hold. If a partial receipt cleared it, the hold would
    // mean nothing.
    const a = freshAdvance({ state: "QUERIED" });
    expect(
      rules.recomputeState(a, { justified_amount: 100000, returned_amount: 0 }),
    ).toBe("QUERIED");
  });

  test("...but a QUERIED advance fully resolved does close", () => {
    const a = freshAdvance({ state: "QUERIED" });
    expect(
      rules.recomputeState(a, { justified_amount: 500000, returned_amount: 0 }),
    ).toBe("JUSTIFIED");
  });

  test("an AGED advance stays aged until it is explicitly un-aged", () => {
    // The money is in 4211; a partial receipt must not silently claim otherwise.
    const a = freshAdvance({ state: "AGED_UNJUSTIFIED" });
    expect(
      rules.recomputeState(a, { justified_amount: 100000, returned_amount: 0 }),
    ).toBe("AGED_UNJUSTIFIED");
  });
});

describe("NEXT — the transition table, including the edges the KB leaves implicit", () => {
  test("JUSTIFIED is terminal", () => {
    expect(rules.NEXT.JUSTIFIED).toEqual([]);
    expect(() =>
      rules.assertTransition("JUSTIFIED", "PARTIALLY_JUSTIFIED"),
    ).toThrow(/Cannot move/);
  });

  test("AGED_UNJUSTIFIED is NOT terminal — aging must not be a one-way door", () => {
    // Without this back-edge the balance sits in 4211 and a late receipt cannot
    // post against 581 because 581 is already flat. Same shape as the costing
    // APPROVED_LOCKED defect.
    expect(rules.NEXT.AGED_UNJUSTIFIED).toContain("ISSUED");
    expect(rules.NEXT.AGED_UNJUSTIFIED).toContain("PARTIALLY_JUSTIFIED");
    expect(
      rules.assertTransition("AGED_UNJUSTIFIED", "PARTIALLY_JUSTIFIED"),
    ).toBe(true);
  });

  test("QUERIED can resolve either way — write-off is not the only exit", () => {
    expect(rules.NEXT.QUERIED).toEqual(
      expect.arrayContaining(["PARTIALLY_JUSTIFIED", "JUSTIFIED"]),
    );
  });

  test("a no-op transition is allowed (a recompute may land where it started)", () => {
    expect(rules.assertTransition("ISSUED", "ISSUED")).toBe(true);
  });

  test("every state named in the table is one the DB CHECK permits", () => {
    // 0230:29 CHECK (state IN (...)). A state here that the DB rejects would
    // fail only at runtime, on a real tenant.
    const DB_STATES = [
      "ISSUED",
      "PARTIALLY_JUSTIFIED",
      "JUSTIFIED",
      "AGED_UNJUSTIFIED",
      "QUERIED",
    ];
    const named = new Set([
      ...Object.keys(rules.NEXT),
      ...Object.values(rules.NEXT).flat(),
    ]);
    for (const s of named) expect(DB_STATES).toContain(s);
  });

  test("every DB state is reachable from somewhere — the original defect", () => {
    const reachable = new Set(Object.values(rules.NEXT).flat());
    for (const s of [
      "PARTIALLY_JUSTIFIED",
      "JUSTIFIED",
      "AGED_UNJUSTIFIED",
      "QUERIED",
    ]) {
      expect(reachable.has(s)).toBe(true);
    }
  });
});

describe("retirementLines — the postings balance and hit the KB's accounts", () => {
  const sum = (lines, side) =>
    Math.round(lines.reduce((s, l) => s + Number(l[side] || 0), 0) * 100) / 100;

  test("RECEIPT is Dr 4731 (per dossier) / Cr 581 — KB step 2", () => {
    const lines = rules.retirementLines(
      { kind: "RECEIPT", amount: 120000, dossierId: DOSSIER },
      ACCOUNTS,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      account_code: "4731",
      debit: 120000,
      credit: 0,
      dossier_id: DOSSIER,
    });
    expect(lines[1]).toMatchObject({
      account_code: "581",
      debit: 0,
      credit: 120000,
    });
  });

  test("CASH_RETURN is Dr 571 / Cr 581 — KB step 3", () => {
    const lines = rules.retirementLines(
      { kind: "CASH_RETURN", amount: 50000 },
      ACCOUNTS,
    );
    expect(lines[0]).toMatchObject({ account_code: "571", debit: 50000 });
    expect(lines[1]).toMatchObject({ account_code: "581", credit: 50000 });
  });

  test("WRITE_OFF is Dr 658 / Cr 581 — KB step 5", () => {
    const lines = rules.retirementLines(
      { kind: "WRITE_OFF", amount: 7500 },
      ACCOUNTS,
    );
    expect(lines[0]).toMatchObject({ account_code: "658", debit: 7500 });
    expect(lines[1]).toMatchObject({ account_code: "581", credit: 7500 });
  });

  test("Σ debits = Σ credits for all three kinds", () => {
    for (const [kind, extra] of [
      ["RECEIPT", { dossierId: DOSSIER }],
      ["CASH_RETURN", {}],
      ["WRITE_OFF", {}],
    ]) {
      const lines = rules.retirementLines(
        { kind, amount: 33333.33, ...extra },
        ACCOUNTS,
      );
      expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
    }
  });

  test("exactly one side of each line is non-zero (chk_one_side, 0220:67)", () => {
    const lines = rules.retirementLines(
      { kind: "RECEIPT", amount: 100, dossierId: DOSSIER },
      ACCOUNTS,
    );
    for (const l of lines) expect(l.debit > 0 !== l.credit > 0).toBe(true);
  });

  test("ONLY the 4731 leg carries a dossier — 571 and 658 are not analytic", () => {
    // 4731 is requires_analytic (9001:113) so the ledger trigger demands one;
    // attaching a dossier to the others would be noise.
    expect(
      rules.retirementLines(
        { kind: "RECEIPT", amount: 10, dossierId: DOSSIER },
        ACCOUNTS,
      )[0].dossier_id,
    ).toBe(DOSSIER);
    expect(
      rules.retirementLines({ kind: "CASH_RETURN", amount: 10 }, ACCOUNTS)[0]
        .dossier_id,
    ).toBeUndefined();
    expect(
      rules.retirementLines({ kind: "WRITE_OFF", amount: 10 }, ACCOUNTS)[0]
        .dossier_id,
    ).toBeUndefined();
  });

  test("the accounts come from the map, not from literals in the module", () => {
    // The point of seed 9094: a tenant that renumbers its chart still posts.
    const custom = { ...ACCOUNTS, regie: "5810", dossier_mandant: "47310" };
    const lines = rules.retirementLines(
      { kind: "RECEIPT", amount: 10, dossierId: DOSSIER },
      custom,
    );
    expect(lines[0].account_code).toBe("47310");
    expect(lines[1].account_code).toBe("5810");
  });

  test("a missing account is a 500, not an undefined account_code on the ledger", () => {
    let thrown;
    try {
      rules.retirementLines(
        { kind: "WRITE_OFF", amount: 10 },
        { regie: "581" },
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown.code).toBe("NO_ACCOUNT");
    expect(thrown.status).toBe(500);
  });
});

describe("assertRetirable — the guards, before anything is written", () => {
  test("refuses more than the open balance", () => {
    const a = freshAdvance({ justified_amount: 480000 });
    expectCode(
      () => rules.assertRetirable(a, { kind: "CASH_RETURN", amount: 25000 }),
      "OVER_RETIRED",
    );
  });

  test("allows exactly the open balance", () => {
    const a = freshAdvance({ justified_amount: 480000 });
    expect(
      rules.assertRetirable(a, { kind: "CASH_RETURN", amount: 20000 }),
    ).toBe(true);
  });

  test("refuses a receipt with no dossier — 4731 requires an analytic dimension", () => {
    expectCode(
      () =>
        rules.assertRetirable(freshAdvance(), {
          kind: "RECEIPT",
          amount: 100,
          proofVaultId: PROOF,
        }),
      "DOSSIER_REQUIRED",
    );
  });

  test("refuses an undocumented receipt when proof is required — KB step 5", () => {
    // "never invent a 4731 line without a document"
    expectCode(
      () =>
        rules.assertRetirable(freshAdvance(), {
          kind: "RECEIPT",
          amount: 100,
          dossierId: DOSSIER,
        }),
      "PROOF_REQUIRED",
    );
  });

  test("...and allows it when the tenant has relaxed that setting", () => {
    expect(
      rules.assertRetirable(
        freshAdvance(),
        { kind: "RECEIPT", amount: 100, dossierId: DOSSIER },
        { requireProofForReceipt: false },
      ),
    ).toBe(true);
  });

  test("a CASH_RETURN never needs proof or a dossier", () => {
    expect(
      rules.assertRetirable(freshAdvance(), {
        kind: "CASH_RETURN",
        amount: 100,
      }),
    ).toBe(true);
  });

  test("refuses a write-off that was not first held as a query — KB step 5", () => {
    expectCode(
      () =>
        rules.assertRetirable(freshAdvance(), {
          kind: "WRITE_OFF",
          amount: 100,
        }),
      "NOT_QUERIED",
    );
  });

  test("...and allows it from QUERIED", () => {
    const a = freshAdvance({ state: "QUERIED" });
    expect(rules.assertRetirable(a, { kind: "WRITE_OFF", amount: 100 })).toBe(
      true,
    );
  });

  test("refuses anything against a closed advance", () => {
    const a = freshAdvance({ justified_amount: 500000, state: "JUSTIFIED" });
    expectCode(
      () => rules.assertRetirable(a, { kind: "CASH_RETURN", amount: 1 }),
      "ALREADY_CLOSED",
    );
  });

  test("refuses a zero or negative amount", () => {
    for (const bad of [0, -1]) {
      expectCode(
        () =>
          rules.assertRetirable(freshAdvance(), {
            kind: "CASH_RETURN",
            amount: bad,
          }),
        "BAD_AMOUNT",
      );
    }
  });

  test("refuses an unknown kind", () => {
    expectCode(
      () =>
        rules.assertRetirable(freshAdvance(), { kind: "REFUND", amount: 10 }),
      "BAD_KIND",
    );
  });

  test("a late receipt against an AGED advance is still permitted", () => {
    // The counterpart to the AGED_UNJUSTIFIED back-edge: the guard must not be
    // what makes aging irreversible.
    const a = freshAdvance({ state: "AGED_UNJUSTIFIED" });
    expect(
      rules.assertRetirable(a, {
        kind: "RECEIPT",
        amount: 100,
        dossierId: DOSSIER,
        proofVaultId: PROOF,
      }),
    ).toBe(true);
  });
});

describe("aging — unchanged behaviour, and the watchlist", () => {
  test("isAged only past the window, and only while open", () => {
    const a = freshAdvance(); // issued 2026-08-01, 7-day window
    expect(rules.isAged(a, "2026-08-08")).toBe(false); // exactly 7 days — not yet
    expect(rules.isAged(a, "2026-08-09")).toBe(true); // 8 days
  });

  test("a fully retired advance never ages", () => {
    const a = freshAdvance({ justified_amount: 500000, state: "JUSTIFIED" });
    expect(rules.isAged(a, "2026-12-31")).toBe(false);
  });

  test("an already-aged advance is not re-aged (idempotent)", () => {
    const a = freshAdvance({ state: "AGED_UNJUSTIFIED" });
    expect(rules.isAged(a, "2026-09-01")).toBe(false);
  });

  test("a QUERIED advance does not age underneath the query", () => {
    const a = freshAdvance({ state: "QUERIED" });
    expect(rules.isAged(a, "2026-09-01")).toBe(false);
  });

  test("daysToWindow uses the ROW's window, not a global default", () => {
    // The window is frozen on the advance at issue, so raising the tenant
    // default must not retroactively un-age advances already in flight.
    const strict = freshAdvance({ policy_window_days: 3 });
    const lax = freshAdvance({ policy_window_days: 30 });
    expect(rules.daysToWindow(strict, "2026-08-05")).toBe(-1);
    expect(rules.daysToWindow(lax, "2026-08-05")).toBe(26);
    expect(rules.isAged(strict, "2026-08-05")).toBe(true);
    expect(rules.isAged(lax, "2026-08-05")).toBe(false);
  });

  test("isDueSoon warns inside the lead time but not after the window has passed", () => {
    const a = freshAdvance(); // window closes 2026-08-08
    expect(rules.isDueSoon(a, "2026-08-05", 2)).toBe(false); // 3 days left
    expect(rules.isDueSoon(a, "2026-08-06", 2)).toBe(true); // 2 days left
    expect(rules.isDueSoon(a, "2026-08-08", 2)).toBe(true); // last day
    expect(rules.isDueSoon(a, "2026-08-09", 2)).toBe(false); // overdue → isAged's job
  });

  test("a closed advance is never on the watchlist", () => {
    const a = freshAdvance({ justified_amount: 500000, state: "JUSTIFIED" });
    expect(rules.isDueSoon(a, "2026-08-06", 2)).toBe(false);
  });
});

describe("the full KB §6.8 walkthrough, end to end", () => {
  test("500,000 issued → 300,000 spent on a dossier → 200,000 returned → 581 is flat", () => {
    let advance = freshAdvance();
    const children = [];

    // Step 2 — the holder comes back with a receipt for 300,000.
    rules.assertRetirable(advance, {
      kind: "RECEIPT",
      amount: 300000,
      dossierId: DOSSIER,
      proofVaultId: PROOF,
    });
    children.push({ kind: "RECEIPT", amount: 300000 });
    let totals = rules.totalsFrom(children);
    let next = rules.recomputeState(advance, totals);
    expect(next).toBe("PARTIALLY_JUSTIFIED");
    rules.assertTransition(advance.state, next);
    advance = { ...advance, ...totals, state: next };
    expect(rules.openBalance(advance)).toBe(200000);

    // Step 3 — the unspent 200,000 comes back to the cash box.
    rules.assertRetirable(advance, { kind: "CASH_RETURN", amount: 200000 });
    children.push({ kind: "CASH_RETURN", amount: 200000 });
    totals = rules.totalsFrom(children);
    next = rules.recomputeState(advance, totals);
    rules.assertTransition(advance.state, next);
    advance = { ...advance, ...totals, state: next };

    // Step 4 — "581 for that advance nets to zero".
    expect(advance.state).toBe("JUSTIFIED");
    expect(rules.openBalance(advance)).toBe(0);

    // And the ledger balances across the whole life of the advance:
    // issue Dr 581 500,000 / Cr 5211 500,000
    // then  Cr 581 300,000 + 200,000 → 581 nets to nil.
    const credits581 = children.reduce((s, c) => s + c.amount, 0);
    expect(credits581).toBe(500000);
  });

  test("the unsupported-spend path: query → write off → closed", () => {
    let advance = freshAdvance({
      justified_amount: 450000,
      state: "PARTIALLY_JUSTIFIED",
    });
    const children = [{ kind: "RECEIPT", amount: 450000 }];
    expect(rules.openBalance(advance)).toBe(50000);

    // 50,000 with no receipt. It must NOT become a 4731 line.
    expectCode(
      () =>
        rules.assertRetirable(advance, {
          kind: "RECEIPT",
          amount: 50000,
          dossierId: DOSSIER,
        }),
      "PROOF_REQUIRED",
    );

    // So it is held as a query instead...
    rules.assertTransition(advance.state, "QUERIED");
    advance = { ...advance, state: "QUERIED" };

    // ...and then written off to 658.
    rules.assertRetirable(advance, { kind: "WRITE_OFF", amount: 50000 });
    children.push({ kind: "WRITE_OFF", amount: 50000 });
    const totals = rules.totalsFrom(children);
    const next = rules.recomputeState(advance, totals);
    rules.assertTransition(advance.state, next);
    advance = { ...advance, ...totals, state: next };

    expect(advance.state).toBe("JUSTIFIED");
    expect(rules.openBalance(advance)).toBe(0);
    expect(advance.returned_amount).toBe(50000);
  });

  test("the late-justification path: aged, then un-aged, then retired", () => {
    // Aged with nothing retired.
    let advance = freshAdvance({ state: "AGED_UNJUSTIFIED" });
    expect(rules.openBalance(advance)).toBe(500000);

    // Un-age restores it to ISSUED (no children yet).
    const totals = rules.totalsFrom([]);
    const restored =
      Number(totals.justified_amount) + Number(totals.returned_amount) > 0
        ? "PARTIALLY_JUSTIFIED"
        : "ISSUED";
    expect(restored).toBe("ISSUED");
    rules.assertTransition(advance.state, restored);
    advance = { ...advance, state: restored };

    // Now the receipts land and it closes normally.
    rules.assertRetirable(advance, {
      kind: "RECEIPT",
      amount: 500000,
      dossierId: DOSSIER,
      proofVaultId: PROOF,
    });
    const after = rules.totalsFrom([{ kind: "RECEIPT", amount: 500000 }]);
    expect(rules.recomputeState(advance, after)).toBe("JUSTIFIED");
  });
});
