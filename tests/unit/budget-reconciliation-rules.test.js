"use strict";

/**
 * Budget Reconciliation — the money rules (MOD-76).
 *
 * Every function under test decides something about money and has to keep
 * deciding it the same way years later: a file settled in 2026 must be
 * reproducible in 2028 in front of an auditor. The owner's own worked example
 * runs through these as the first block, deliberately — if that stops behaving
 * the way it was described, the module is wrong no matter what else passes.
 */

const rules = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.rules");

/** A grid row as `repo.gridFor` returns it. Budget 119 250 TTC = 100 000 net +
 *  19 250 VAT, which is the owner's own example under Q4. */
const row = (over = {}) => ({
  costing_line_id: "cl-1",
  line_no: 1,
  label: "Port Charges",
  is_disbursement: false,
  qty: 1,
  unit_cost: 100000,
  net: 100000,
  vat: 19250,
  budget_ttc: 119250,
  committed: 119250,
  pending: 0,
  disbursed: 119250,
  justification_required: false,
  document_count: 0,
  line_id: null,
  ...over,
});

describe("the pre-fill — 'we gave you 119 250, is that what you spent?'", () => {
  test("an untouched line shows what was DISBURSED, and says nobody has looked", () => {
    const v = rules.lineView(row());
    expect(v.actual_ttc).toBe(119250);
    expect(v.actual_source).toBe("DERIVED");
    expect(v.variance).toBe(0);
  });

  test("a line budgeted but never funded pre-fills 0, not its budget", () => {
    // Unused budget is not a saving anybody achieved (Q14). Pre-filling the
    // budget would report a file as fully spent because nobody opened it.
    const v = rules.lineView(row({ committed: 0, disbursed: 0 }));
    expect(v.actual_ttc).toBe(0);
    expect(v.funded).toBe(false);
    expect(v.variance).toBe(119250);
  });

  test("once touched, the stored actual wins over the pre-fill", () => {
    const v = rules.lineView(row({ line_id: "rl-1", actual_ttc: 131250, actual_source: "OVERRIDDEN" }));
    expect(v.actual_ttc).toBe(131250);
    expect(v.variance).toBe(-12000);
    expect(v.over_budget).toBe(true);
  });

  test("a stored zero is a real answer, not an absent one", () => {
    // The line was funded and the money came back. `line_id` present means a
    // person said so; falling back to `disbursed` here would overwrite them.
    const v = rules.lineView(row({ line_id: "rl-1", actual_ttc: 0, actual_source: "OVERRIDDEN" }));
    expect(v.actual_ttc).toBe(0);
    expect(v.outstanding).toBe(119250);
  });
});

describe("the overspend allowance — BOTH thresholds, or neither (Q13)", () => {
  const allowance = { amount: 1000, percent: 2 };

  test("2% of a 2 500 000 customs line is 50 000, and 60 000 over must be explained", () => {
    const line = rules.lineView(
      row({ line_id: "rl", budget_ttc: 2500000, net: 2500000, vat: 0, actual_ttc: 2560000 }),
      allowance,
    );
    expect(line.reason_required).toBe(true);
  });

  test("2% of a 5 000 line is 100, and 900 over must NOT nag — the floor decides", () => {
    const line = rules.lineView(
      row({ line_id: "rl", budget_ttc: 5000, net: 5000, vat: 0, actual_ttc: 5900 }),
      allowance,
    );
    expect(line.reason_required).toBe(false);
  });

  test("a large absolute overrun on a large line is caught by the percentage", () => {
    // 1 500 over clears the 1 000 floor but is 0.06% of the line — the
    // percentage is what stops this being a nag on a big number.
    const line = rules.lineView(
      row({ line_id: "rl", budget_ttc: 2500000, net: 2500000, vat: 0, actual_ttc: 2501500 }),
      allowance,
    );
    expect(line.reason_required).toBe(false);
  });

  test("exactly at each edge is inside the allowance, not over it", () => {
    const atFloor = rules.lineView(
      row({ line_id: "rl", budget_ttc: 10000, net: 10000, vat: 0, actual_ttc: 11000 }),
      allowance,
    );
    expect(atFloor.reason_required).toBe(false);
    const atPercent = rules.lineView(
      row({ line_id: "rl", budget_ttc: 100000, net: 100000, vat: 0, actual_ttc: 102000 }),
      allowance,
    );
    expect(atPercent.reason_required).toBe(false);
  });

  test("spending against a line with no budget always needs a reason", () => {
    // A percentage of zero is not a test, and money spent against a line worth
    // nothing is the largest overrun there is.
    const line = rules.lineView(
      row({ line_id: "rl", budget_ttc: 0, net: 0, vat: 0, actual_ttc: 4000 }),
      allowance,
    );
    expect(line.reason_required).toBe(true);
  });

  test("under budget never needs a reason — 'if we spent less it is good'", () => {
    const line = rules.lineView(row({ line_id: "rl", actual_ttc: 80000 }), allowance);
    expect(line.reason_required).toBe(false);
    expect(line.variance).toBeGreaterThan(0);
  });

  test("a malformed tenant setting falls back to the defaults rather than to zero", () => {
    // An allowance of 0/0 would demand a reason for a one-franc rounding.
    expect(rules.allowanceFrom({})).toEqual(rules.DEFAULT_ALLOWANCE);
    expect(rules.allowanceFrom({ overspend_allowance_amount: "nonsense" }).amount)
      .toBe(rules.DEFAULT_ALLOWANCE.amount);
  });
});

describe("proof — who owes a receipt (Q9, Q10)", () => {
  test("a ticked line with spend and no document owes one", () => {
    const v = rules.lineView(row({ line_id: "rl", actual_ttc: 119250, justification_required: true }));
    expect(v.proof_missing).toBe(true);
  });

  test("a ticked line that was never spent owes nothing", () => {
    // The legacy had this condition and it was the one part of its gate that
    // was right: a budgeted line nobody spent has no receipt to produce.
    const v = rules.lineView(row({ line_id: "rl", actual_ttc: 0, justification_required: true, disbursed: 0 }));
    expect(v.proof_missing).toBe(false);
  });

  test("one document clears it — and a second is still allowed", () => {
    const v = rules.lineView(row({ line_id: "rl", actual_ttc: 119250, justification_required: true, document_count: 2 }));
    expect(v.proof_missing).toBe(false);
  });

  test("an unticked line owes nothing however much was spent", () => {
    const v = rules.lineView(row({ line_id: "rl", actual_ttc: 500000, justification_required: false }));
    expect(v.proof_missing).toBe(false);
  });
});

describe("outstanding — the cash a person still has to account for (Q14)", () => {
  test("disbursed, partly spent, nothing returned", () => {
    const v = rules.lineView(row({ line_id: "rl", disbursed: 119250, actual_ttc: 100000 }));
    expect(v.outstanding).toBe(19250);
  });

  test("returning the balance clears it", () => {
    const v = rules.lineView(row({ line_id: "rl", disbursed: 119250, actual_ttc: 100000, returned_amount: 19250 }));
    expect(v.outstanding).toBe(0);
  });

  test("spending more than was disbursed puts the file in credit, not in debt", () => {
    const v = rules.lineView(row({ line_id: "rl", disbursed: 100000, actual_ttc: 119250 }));
    expect(v.outstanding).toBe(-19250);
  });
});

describe("the HT margin indicator — one figure, derived (Q4)", () => {
  test("strips the line's own VAT back off its TTC actual", () => {
    // 119 250 TTC on a 100 000 + 19 250 line is 100 000 HT.
    expect(rules.actualHt([rules.lineView(row({ line_id: "rl", actual_ttc: 119250 }))])).toBe(100000);
  });

  test("débours are excluded entirely — pass-through is neither revenue nor cost", () => {
    const debours = rules.lineView(row({ line_id: "rl", is_disbursement: true, actual_ttc: 2500000, net: 2500000, vat: 0 }));
    const service = rules.lineView(row({ line_id: "rl", actual_ttc: 119250 }));
    expect(rules.actualHt([debours, service])).toBe(100000);
  });

  test("a zero-net line cannot imply a rate, so its actual is read as HT already", () => {
    const v = rules.lineView(row({ line_id: "rl", net: 0, vat: 0, budget_ttc: 0, actual_ttc: 5000 }));
    expect(rules.actualHt([v])).toBe(5000);
  });
});

describe("the footer and the three grades (Q17)", () => {
  const lines = () => [
    rules.lineView(row({ line_id: "a", label: "Port Charges", actual_ttc: 131250, actual_source: "OVERRIDDEN", justification_required: true, document_count: 1 })),
    rules.lineView(row({ line_id: "b", label: "Customs", budget_ttc: 2500000, net: 2500000, vat: 0, committed: 2500000, disbursed: 2500000, actual_ttc: 2480000, actual_source: "CONFIRMED", is_disbursement: true })),
    rules.lineView(row({ label: "THC", budget_ttc: 236115, net: 198000, vat: 38115, committed: 0, disbursed: 0 })),
  ];

  test("totals foot across the grid", () => {
    const { totals } = rules.summarise(lines());
    expect(totals.budget_ttc).toBe(119250 + 2500000 + 236115);
    expect(totals.actual_ttc).toBe(131250 + 2480000 + 0);
    expect(totals.variance).toBe(totals.budget_ttc - totals.actual_ttc);
    expect(totals.lines_over_budget).toBe(1);
  });

  test("execution and commercial come apart, which is why there are two", () => {
    // Under budget overall, but quoted below what it cost: EFFICIENT and a
    // loss at once. One number would tell somebody something untrue.
    const { grades } = rules.summarise(lines(), { quotedHt: 50000 });
    expect(grades.execution.key).toBe("WITHIN_BUDGET");
    expect(grades.commercial.key).toBe("LOSS");
  });

  test("no accepted quotation → no commercial verdict rather than a fake red", () => {
    const { grades, totals } = rules.summarise(lines());
    expect(grades.commercial.key).toBe("NO_QUOTE");
    expect(totals.margin_ht).toBeNull();
  });

  test("a grid nobody has touched is PENDING, not 'within budget'", () => {
    const untouched = [rules.lineView(row())];
    expect(rules.summarise(untouched).grades.execution.key).toBe("PENDING");
  });

  test("accountability nets across the file, because the holder holds one purse", () => {
    // Port Charges went 12 000 OVER what was disbursed for it; Customs came in
    // 20 000 under. The holder took 2 619 250 and spent 2 611 250, so 8 000 is
    // what Finance should see back — netting is the honest answer here because
    // the cash was handed to one person against one file, not ring-fenced per
    // line. The per-line figures stay visible for the line that overran.
    const ls = lines();
    expect(ls[0].outstanding).toBe(-12000);
    expect(ls[1].outstanding).toBe(20000);
    const { grades } = rules.summarise(ls);
    expect(grades.accountability.key).toBe("OUTSTANDING");
    expect(grades.accountability.amount).toBe(8000);
  });

  test("a percentage of nothing is null, never 0%", () => {
    expect(rules.pct(5, 0)).toBeNull();
    expect(rules.pct(5, 100)).toBe(5);
  });
});

describe("submission blockers — one list, not five rounds of 422", () => {
  test("reasons and proofs are reported together", () => {
    const lines = [
      rules.lineView(row({ line_id: "a", label: "Port Charges", actual_ttc: 131250 })),
      rules.lineView(row({ line_id: "b", label: "Customs", actual_ttc: 50000, justification_required: true })),
    ];
    const blockers = rules.submissionBlockers(lines);
    expect(blockers.map((b) => b.kind).sort()).toEqual(["PROOF", "REASON"]);
    expect(blockers.every((b) => b.label && b.costing_line_id)).toBe(true);
  });

  test("a clean sheet blocks nothing", () => {
    const lines = [rules.lineView(row({ line_id: "a", actual_ttc: 100000 }))];
    expect(rules.submissionBlockers(lines)).toEqual([]);
  });
});
