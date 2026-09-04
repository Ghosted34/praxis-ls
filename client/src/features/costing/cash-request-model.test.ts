/**
 * The cash-request worksheet's arithmetic (12771).
 *
 * ── WHY THIS FILE MATTERS MORE THAN A USUAL MODEL TEST ─────────────────────
 *
 * `lineClaim`, `lineAmount` and `fromBudgetLine` are the browser's copy of
 * server rules — `cash_request.rules.lineClaim` and
 * `cash_request.service.claimFromBudgetLine`. They are duplicated deliberately:
 * the grid shows a running total and a Remaining column before it saves, and it
 * cannot ask the server on every keystroke.
 *
 * The server stays the authority — every gate re-derives, and a 422 is the last
 * word — but if these drift, the screen tells somebody they are inside their
 * budget and the approval then refuses them. So they are pinned against the
 * SAME figures the server's own tests use: the owner's file, Port Charges
 * 150 000 / Customs Duties 2 500 000 / Terminal Handling 2 × 99 000 + 38 115.
 */
import { describe, it, expect } from "vitest";
import {
  BLANK_LINE,
  computeTotals,
  fromBudgetLine,
  fromSaved,
  isEditable,
  isOverBudget,
  lineAmount,
  lineClaim,
  lineRemainingAfter,
  pickedLines,
  statusLabel,
  statusTone,
  toPayload,
  type LineDraft,
} from "./cash-request-model";
import type { BudgetLine } from "@/lib/costing-api";

const draft = (over: Partial<LineDraft> = {}): LineDraft => ({ ...BLANK_LINE, ...over });

const budgetLine = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  costing_line_id: "L1",
  line_no: 1,
  label: "Port Charges",
  qty: 1,
  unit_cost: 150000,
  net: 150000,
  vat: 0,
  budget: 150000,
  committed: 0,
  pending: 0,
  disbursed: 0,
  remaining: 150000,
  over_committed: false,
  ...over,
});

describe("lineAmount / lineClaim — the browser's copy of the server rule", () => {
  it("the claim is TTC, because the budget is TTC", () => {
    // Claiming the net alone would draw down less than the cash that actually
    // leaves — the defect 10746 fixed on the header, one level up.
    const l = draft({ qty: 2, unit_cost: 99000, vat_percent: 19.25 });
    expect(lineAmount(l)).toBe(198000);
    expect(lineClaim(l)).toBe(236115);
  });

  it("no VAT means the net is the claim", () => {
    expect(lineClaim(draft({ qty: 1, unit_cost: 2500000 }))).toBe(2500000);
  });

  it("an empty line is 0, never NaN", () => {
    expect(lineClaim(draft({ qty: 0, unit_cost: 0 }))).toBe(0);
  });
});

describe("computeTotals — the voucher footer", () => {
  it("totals the owner's three lines to the cash the file needs", () => {
    const t = computeTotals([
      draft({ qty: 1, unit_cost: 150000 }),
      draft({ qty: 1, unit_cost: 2500000 }),
      draft({ qty: 2, unit_cost: 99000, vat_percent: 19.25 }),
    ]);
    expect(t.subtotal).toBe(2848000);
    expect(t.vat_total).toBe(38115);
    expect(t.total_payable).toBe(2886115);
  });

  it("an UNTICKED line is not part of the request, so it is not in the footer", () => {
    // The footer must agree with what is about to be submitted; counting a
    // line the user has just excluded is the surest way to lose their trust in
    // the number.
    const t = computeTotals([
      draft({ qty: 1, unit_cost: 150000 }),
      draft({ qty: 1, unit_cost: 2500000, picked: false }),
    ]);
    expect(t.total_payable).toBe(150000);
    expect(pickedLines([draft(), draft({ picked: false })])).toHaveLength(1);
  });

  it("an empty sheet totals zero", () => {
    expect(computeTotals([])).toEqual({ subtotal: 0, vat_total: 0, total_payable: 0 });
  });
});

describe("the Remaining column", () => {
  it("shows what would be left on the budget line after this claim", () => {
    const l = draft({ qty: 1, unit_cost: 100000, remaining: 150000, budget: 150000 });
    expect(lineRemainingAfter(l)).toBe(50000);
    expect(isOverBudget(l)).toBe(false);
  });

  it("goes negative and flags, rather than clamping at zero", () => {
    const l = draft({ qty: 1, unit_cost: 180000, remaining: 150000, budget: 150000 });
    expect(lineRemainingAfter(l)).toBe(-30000);
    expect(isOverBudget(l)).toBe(true);
  });

  it("an overhead line has no budget, so it has no Remaining and is never over", () => {
    const l = draft({ qty: 1, unit_cost: 999999 });
    expect(lineRemainingAfter(l)).toBeNull();
    expect(isOverBudget(l)).toBe(false);
  });
});

describe("fromBudgetLine — the default is what is LEFT, not what was budgeted", () => {
  it("carries the costing's own shape across, at the TTC unit", () => {
    // 2 × 99 000 stays TWO BOXES, so an approver can see a container count
    // change rather than one flattened number — but the unit is now the TTC
    // unit, because a cash request carries no VAT rate of its own.
    const l = fromBudgetLine(
      budgetLine({ label: "THC", qty: 2, unit_cost: 99000, net: 198000, vat: 38115, budget: 236115, remaining: 236115 }),
    );
    expect(l.qty).toBe(2);
    // 236 115 / 2 — the budget line's own TTC, split over its own quantity.
    expect(l.unit_cost).toBe(118057.5);
    expect(l.vat_percent).toBeNull();
    // And the claim lands EXACTLY on the budget. It used to be reconstructed
    // as net × a rate derived to four places, which could miss by a cent
    // against a balance compared to the cent.
    expect(lineClaim(l)).toBe(236115);
    expect(l.picked).toBe(true);
  });

  it("a fractional TTC unit can only ever underclaim, never breach", () => {
    // 100 / 3 is 33.333…; flooring the unit keeps 3 × unit at or under the
    // budget. Overshooting would make an untouched import read as over budget.
    const l = fromBudgetLine(budgetLine({ qty: 3, net: 100, vat: 0, budget: 100, remaining: 100 }));
    expect(l.unit_cost).toBe(33.33);
    expect(lineClaim(l)).toBeLessThanOrEqual(100);
  });

  it("a partial top-up is one line at the remaining net, not a fraction of a container", () => {
    const l = fromBudgetLine(budgetLine({ remaining: 50000, committed: 100000 }));
    expect(l.qty).toBe(1);
    expect(l.unit_cost).toBe(50000);
    expect(lineClaim(l)).toBe(50000);
  });

  it("a reconstructed partial claim never overshoots the balance", () => {
    // The rate is derived by division and rounded, and a rounded rate applied
    // back to a net can land a hair over — which would read as a breach of the
    // budget the line was just imported from.
    const l = fromBudgetLine(
      budgetLine({ net: 198000, vat: 38115, budget: 236115, remaining: 100000, committed: 136115 }),
    );
    expect(lineClaim(l)).toBeLessThanOrEqual(100000);
  });

  it("a fully-claimed line arrives unticked — it is not a claim", () => {
    const l = fromBudgetLine(budgetLine({ remaining: 0, committed: 150000 }));
    expect(l.picked).toBe(false);
  });

  it("the equipment a per-container charge was priced for is in the label", () => {
    // Two "Demurrage" lines with two amounts and no way to tell them apart is
    // the legacy defect D10; the container type is what distinguishes them.
    const l = fromBudgetLine(budgetLine({ label: "Demurrage", container_type_code: "40HC" }));
    expect(l.label).toBe("Demurrage — 40HC");
  });
});

describe("fromSaved / toPayload — a round trip keeps line identity", () => {
  it("carries the ids the server matches on", () => {
    // Without `cash_request_line_id` the server reads every line as new,
    // deletes the originals, and the budget link goes with them.
    const l = fromSaved({
      cash_request_line_id: "CRL-1",
      costing_line_id: "L1",
      label: "Port Charges",
      qty: 1,
      unit_cost: 150000,
      vat_percent: null,
    });
    const payload = toPayload(l);
    expect(payload.cash_request_line_id).toBe("CRL-1");
    expect(payload.costing_line_id).toBe("L1");
    expect(payload.qty).toBe(1);
    expect(payload.unit_cost).toBe(150000);
  });

  it("a line with only budget_amount is read as 1 × that amount", () => {
    // Every caller that predates 12771 sends this shape.
    const l = fromSaved({ label: "Legacy line", budget_amount: 75000 });
    expect(l.qty).toBe(1);
    expect(l.unit_cost).toBe(75000);
    expect(lineClaim(l)).toBe(75000);
  });

  it("attaches the budget line's balance when one is supplied", () => {
    const l = fromSaved(
      { costing_line_id: "L1", label: "Port Charges", qty: 1, unit_cost: 100000 },
      budgetLine({ remaining: 150000 }),
    );
    // The ledger excludes THIS request, so `remaining` is what is available to
    // it — its own claim is not counted against itself.
    expect(l.remaining).toBe(150000);
    expect(lineRemainingAfter(l)).toBe(50000);
  });
});

describe("numerics off the wire are coerced at the boundary", () => {
  /*
   * THE DEFECT THIS PINS, exactly as it reached a user.
   *
   * `pg` returns Postgres `numeric` as a STRING — deliberately, because a float
   * cannot hold arbitrary precision. So every money column on a cash request
   * line arrives as text while the API types declare `number`, and TypeScript
   * believes the declaration.
   *
   * It hid because every reader wraps its input in `Number()`: the grid, the
   * totals and the Remaining column were all right on screen. Only SAVE failed.
   *
   * ONE field did it — `vat_percent`, the only one `fromSaved` passed through
   * raw — on every line at once, so a three-line request reported
   * "Expected number, received string" three times and read like three
   * problems. A worksheet that displays perfectly and cannot be saved is the
   * worst shape a bug can take, so the rest is coerced too rather than left to
   * be the next one.
   */
  const wire = <T,>(o: T) => o as T;

  it("a full-claim budget line does not carry strings into the payload", () => {
    // qty and unit_cost — two of the three the user actually hit.
    const line = fromBudgetLine(
      wire(budgetLine({ qty: "2" as never, unit_cost: "75000" as never, net: "150000" as never, budget: "150000" as never, remaining: "150000" as never })),
    );
    expect(typeof line.qty).toBe("number");
    expect(typeof line.unit_cost).toBe("number");
    expect(line.qty).toBe(2);
    expect(line.unit_cost).toBe(75000);
    // And the derived columns are numbers too, or the Remaining maths silently
    // becomes string concatenation.
    expect(typeof line.remaining).toBe("number");
    expect(typeof line.budget).toBe("number");
  });

  it("a saved line's VAT rate is coerced, and a null rate stays null", () => {
    // The third field. `null` must NOT become 0: no VAT and 0% VAT are the same
    // arithmetic but not the same statement, and the column is nullable.
    const withVat = fromSaved(wire({ cash_request_line_id: "c1", label: "x", vat_percent: "19.25" as never, qty: "1" as never, unit_cost: "75000" as never }));
    expect(typeof withVat.vat_percent).toBe("number");
    expect(withVat.vat_percent).toBe(19.25);
    const without = fromSaved(wire({ cash_request_line_id: "c2", label: "y", vat_percent: null, qty: 1, unit_cost: 100 }));
    expect(without.vat_percent).toBeNull();
  });

  it("toPayload emits numbers even if a string reached the draft", () => {
    // The belt-and-braces guard at the exit: this is the edge where a
    // regression becomes a 422 in somebody's face rather than a wrong pixel.
    const p = toPayload(draft(wire({ qty: "3" as never, unit_cost: "1000" as never, vat_percent: "5" as never })));
    expect(typeof p.qty).toBe("number");
    expect(typeof p.unit_cost).toBe("number");
    expect(typeof p.vat_percent).toBe("number");
    expect(p).toMatchObject({ qty: 3, unit_cost: 1000, vat_percent: 5 });
  });

  it("a nonsense value falls back rather than becoming NaN", () => {
    // NaN in a payload is `null` after JSON.stringify, which Zod rejects with a
    // different and more confusing message than the one we just fixed.
    const p = toPayload(draft(wire({ qty: "" as never, unit_cost: "abc" as never })));
    expect(p.qty).toBe(1);
    expect(p.unit_cost).toBe(0);
  });
});

describe("statuses are said out loud, never shown raw", () => {
  it("names every state the machine can be in", () => {
    for (const [s, said] of [
      ["DRAFT", "Draft"],
      ["SUBMITTED", "To validate"],
      ["VALIDATED", "To approve"],
      ["APPROVED", "To disburse"],
      ["PARTIALLY_DISBURSED", "Part paid"],
      ["DISBURSED", "Disbursed"],
      ["CLOSED_SHORT", "Settled short"],
      ["JUSTIFIED", "Justified"],
      ["REJECTED", "Rejected"],
    ] as const) {
      expect(statusLabel(s)).toBe(said);
    }
  });

  it("an unknown status falls back to itself rather than to nothing", () => {
    expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(statusTone("SOMETHING_NEW")).toBe("mute");
  });

  it("only a DRAFT is editable — the server refuses the rest", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("SUBMITTED")).toBe(false);
    expect(isEditable("APPROVED")).toBe(false);
  });
});
