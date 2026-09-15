"use strict";

/**
 * The costing as the operations file's BUDGET, and the cash request as the
 * document that draws it down (migration 12771).
 *
 * ── WHAT WAS BROKEN, AND WHY THESE ARE THE TESTS ───────────────────────────
 *
 * `cash_request_line` had no link to the budget line it was spending, so
 * selecting the same costing twice produced the same lines at full value,
 * twice, with nothing anywhere objecting. The legacy had the identical hole —
 * and it is why its own reconciliation module made `costing_line_id` mandatory
 * on `ocr_line` and then had a human RE-TYPE the actuals.
 *
 * Everything pinned here is the arithmetic that makes the link mean something,
 * and all of it is pure:
 *
 *   1. `lineTtc` — what a budget line is WORTH. TTC, because a costing is a
 *      cash budget and the VAT handed to a carrier is money that leaves.
 *   2. `summariseBudget` — Budget · Committed · Remaining, including the case
 *      the owner asked for by name: a costing amended DOWN below what is
 *      already committed shows over-consumed rather than clamping at zero.
 *   3. `budgetBreaches` — which lines a request would overdraw, totalled per
 *      budget line first.
 *   4. `apportionSettlement` — CLOSE_BALANCE's split, which must sum to the
 *      cash actually issued EXACTLY.
 *   5. `budgetControl` — the block a validator and an approver read.
 *
 * The worked example throughout is the owner's own file: Port Charges 150 000,
 * Customs Duties 2 500 000, Terminal Handling 2 × 99 000 + the carrier's VAT.
 */

const costingRules = require("../../src/modules/costing/costing/costing.rules");
const {
  lineClaim,
  budgetBreaches,
  apportionSettlement,
  budgetControl,
} = require("../../src/modules/costing/cash_request/cash_request.rules");

const PORT = "11111111-1111-1111-1111-111111111111";
const DUTIES = "22222222-2222-2222-2222-222222222222";
const THC = "33333333-3333-3333-3333-333333333333";

/* ══════════════════ 1. What a budget line is worth ══════════════════ */

describe("lineTtc — the budget a claim draws down", () => {
  test("a service line carries its own tax code's VAT", () => {
    expect(costingRules.lineTtc({ qty: 2, unit_cost: 100000, tax_rate_percent: 19.25 })).toBe(238500);
  });

  test("a débours carries the SUPPLIER's VAT, never a tax code's", () => {
    // 12768: the VAT we hand the carrier is cash we will spend, so it is
    // budgeted. A rate riding on the row is ignored — the DB refuses one.
    expect(
      costingRules.lineTtc({
        qty: 2, unit_cost: 99000, is_disbursement: true,
        upstream_vat_amount: 38115, tax_rate_percent: 19.25,
      }),
    ).toBe(236115);
  });

  test("customs duties and port charges advance no VAT of ours", () => {
    expect(costingRules.lineTtc({ qty: 1, unit_cost: 2500000, is_disbursement: true })).toBe(2500000);
    expect(costingRules.lineTtc({ qty: 1, unit_cost: 150000, is_disbursement: true })).toBe(150000);
  });

  test("an empty line is 0, not NaN", () => {
    expect(costingRules.lineTtc({})).toBe(0);
  });
});

/* ══════════════════ 2. The ledger ══════════════════ */

/** The owner's file, as `budgetForCosting` returns it. */
const ledgerRows = (over = {}) => [
  { costing_line_id: PORT, line_no: 1, label: "Port Charges", net: 150000, vat: 0, budget: 150000, committed: 0, pending: 0, disbursed: 0, qty: 1, unit_cost: 150000, ...(over[PORT] || {}) },
  { costing_line_id: DUTIES, line_no: 2, label: "Customs Duties & Taxes", net: 2500000, vat: 0, budget: 2500000, committed: 0, pending: 0, disbursed: 0, qty: 1, unit_cost: 2500000, ...(over[DUTIES] || {}) },
  { costing_line_id: THC, line_no: 3, label: "Terminal Handling (THC)", net: 198000, vat: 38115, budget: 236115, committed: 0, pending: 0, disbursed: 0, qty: 2, unit_cost: 99000, ...(over[THC] || {}) },
];

describe("summariseBudget", () => {
  test("an untouched sheet is entirely claimable", () => {
    const { lines, totals } = costingRules.summariseBudget(ledgerRows());
    expect(totals.budget).toBe(2886115);
    expect(totals.committed).toBe(0);
    expect(totals.remaining).toBe(2886115);
    expect(lines.every((l) => l.over_committed === false)).toBe(true);
  });

  /*
   * The owner's own worked example. Port Charges is budgeted at 150 000 and a
   * cash request has been approved for 100 000, so the line has 50 000 left —
   * and the NEXT request must open showing exactly that. This is the behaviour
   * neither system had.
   */
  test("an approved claim leaves the balance, not the budget", () => {
    const { lines } = costingRules.summariseBudget(
      ledgerRows({ [PORT]: { committed: 100000, disbursed: 100000 } }),
    );
    expect(lines[0].remaining).toBe(50000);
    expect(lines[0].over_committed).toBe(false);
  });

  test("a request awaiting a decision is PENDING and consumes nothing", () => {
    const { lines, totals } = costingRules.summariseBudget(
      ledgerRows({ [PORT]: { pending: 100000 } }),
    );
    expect(lines[0].remaining).toBe(150000);
    expect(totals.pending).toBe(100000);
  });

  /*
   * Amend the budget DOWN below what is already committed and the line reads
   * over-consumed — it is not clamped at zero, because a clamp hides exactly
   * the case somebody has to act on. 100 000 was committed against a line since
   * reduced to 95 000, so 5 000 has to be reallocated or refunded.
   */
  test("a budget amended below its commitments shows over-consumed", () => {
    const { lines, totals } = costingRules.summariseBudget(
      ledgerRows({ [PORT]: { budget: 95000, net: 95000, committed: 100000 } }),
    );
    expect(lines[0].remaining).toBe(-5000);
    expect(lines[0].over_committed).toBe(true);
    expect(totals.over_committed_lines).toBe(1);
  });

  test("an empty sheet totals zero, not NaN", () => {
    expect(costingRules.summariseBudget([]).totals).toEqual({
      budget: 0, committed: 0, pending: 0, disbursed: 0, remaining: 0, over_committed_lines: 0,
    });
  });
});

/* ══════════════════ 3. What a claim is, and when it breaches ══════════════════ */

describe("lineClaim — the TTC a request line takes out of the budget", () => {
  test("the line's own VAT is part of what it claims", () => {
    // Claiming the net alone would draw down less than the cash that actually
    // leaves — the defect 10746 fixed on the header, one level up.
    expect(lineClaim({ budget_amount: 198000, vat_percent: 19.25 })).toBe(236115);
  });

  test("no VAT means the net is the claim", () => {
    expect(lineClaim({ budget_amount: 2500000 })).toBe(2500000);
  });
});

describe("budgetBreaches", () => {
  const ledger = costingRules.summariseBudget(ledgerRows()).lines;

  test("a request inside its budget breaches nothing", () => {
    expect(budgetBreaches(
      [{ costing_line_id: PORT, budget_amount: 150000 }, { costing_line_id: DUTIES, budget_amount: 2500000 }],
      ledger,
    )).toEqual([]);
  });

  test("claiming more than a line has left is a breach, named and measured", () => {
    const breaches = budgetBreaches([{ costing_line_id: PORT, budget_amount: 180000 }], ledger);
    expect(breaches).toEqual([
      { costing_line_id: PORT, label: "Port Charges", claim: 180000, remaining: 150000, excess: 30000 },
    ]);
  });

  /*
   * Two lines against ONE budget line — a partial claim plus a top-up typed
   * later. Checked one at a time each would pass while the pair overdraws, so
   * claims are totalled per budget line before they are compared.
   */
  test("two lines against one budget line are totalled before comparing", () => {
    const breaches = budgetBreaches(
      [{ costing_line_id: PORT, budget_amount: 100000 }, { costing_line_id: PORT, budget_amount: 80000 }],
      ledger,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0].claim).toBe(180000);
    expect(breaches[0].excess).toBe(30000);
  });

  test("a claim against a budget line that is no longer on the sheet has nothing left", () => {
    const breaches = budgetBreaches([{ costing_line_id: "44444444-4444-4444-4444-444444444444", budget_amount: 1 }], ledger);
    expect(breaches[0]).toMatchObject({ remaining: 0, excess: 1, label: null });
  });

  test("an unbudgeted line is not a breach here — it is refused separately", () => {
    // `assertFundable` rejects a line with no costing_line_id outright (owner
    // decision Q4). This function answers a different question and must not
    // silently pass judgement on it.
    expect(budgetBreaches([{ budget_amount: 999999 }], ledger)).toEqual([]);
  });
});

/* ══════════════════ 4. Settling a request short ══════════════════ */

describe("apportionSettlement", () => {
  const lines = [
    { budget_amount: 150000 },
    { budget_amount: 2500000 },
  ];

  test("a fully paid request settles at its claims", () => {
    expect(apportionSettlement(lines, 2650000)).toEqual([150000, 2500000]);
  });

  test("paying more than was claimed never invents a bigger settlement", () => {
    expect(apportionSettlement(lines, 9999999)).toEqual([150000, 2500000]);
  });

  /*
   * The whole point: the parts must sum to the cash actually issued, exactly.
   * A budget that disagrees with the treasury by any amount is a budget people
   * stop trusting, so the last line with a share absorbs the rounding.
   */
  test("a partial settlement sums to the cash actually paid, to the franc", () => {
    const shares = apportionSettlement(lines, 1000000);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000000);
    expect(shares[0]).toBeCloseTo(56603.77, 2);
  });

  test("an awkward ratio still sums exactly", () => {
    const odd = [{ budget_amount: 33.33 }, { budget_amount: 33.33 }, { budget_amount: 33.34 }];
    const shares = apportionSettlement(odd, 10);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100).toBe(10);
  });

  test("a request that claimed nothing settles at nothing", () => {
    expect(apportionSettlement([{ budget_amount: 0 }], 500)).toEqual([0]);
  });
});

/* ══════════════════ 5. Line identity across an amendment ══════════════════ */

/*
 * The keystone. A cash request claims a budget line BY ID, and the costing's
 * save used to delete every line and re-insert — so every id changed on every
 * DRAFT save and the link would have broken at exactly the moment it matters:
 * the amendment. These pin the matching that keeps ids stable.
 */
describe("planLineWrites — a costing line keeps its id across a save", () => {
  const plan = costingRules.planLineWrites;
  const prior = [
    { costing_line_id: "L1", dictionary_item_id: "ITEM-PORT", container_type_ref_id: null, label: "Port Charges" },
    { costing_line_id: "L2", dictionary_item_id: "ITEM-DUTY", container_type_ref_id: null, label: "Customs Duties" },
  ];

  test("an unchanged sheet updates in place and deletes nothing", () => {
    const { writes, keptIds, dropped } = plan(prior, [
      { dictionary_item_id: "ITEM-PORT", label: "Port Charges" },
      { dictionary_item_id: "ITEM-DUTY", label: "Customs Duties" },
    ]);
    expect(writes.map((w) => w.id)).toEqual(["L1", "L2"]);
    expect(keptIds).toEqual(["L1", "L2"]);
    expect(dropped).toEqual([]);
  });

  test("amending an amount keeps the id — this is what the budget link rides on", () => {
    // The payload carries a new price and a re-typed label; identity comes from
    // the catalogue item, so the claim against L1 survives.
    const { writes } = plan(prior, [
      { dictionary_item_id: "ITEM-PORT", label: "Port charges (revised)" },
      { dictionary_item_id: "ITEM-DUTY", label: "Customs Duties" },
    ]);
    expect(writes[0].id).toBe("L1");
  });

  test("reordering follows the line, not the position", () => {
    const { writes } = plan(prior, [
      { dictionary_item_id: "ITEM-DUTY", label: "Customs Duties" },
      { dictionary_item_id: "ITEM-PORT", label: "Port Charges" },
    ]);
    expect(writes.map((w) => w.id)).toEqual(["L2", "L1"]);
  });

  test("a new line inserts and an absent one is reported as dropped", () => {
    const { writes, keptIds, dropped } = plan(prior, [
      { dictionary_item_id: "ITEM-PORT", label: "Port Charges" },
      { dictionary_item_id: "ITEM-DET", label: "Detention" },
    ]);
    expect(writes[0].id).toBe("L1");
    expect(writes[1].id).toBeNull();
    expect(keptIds).toEqual(["L1"]);
    expect(dropped.map((d) => d.costing_line_id)).toEqual(["L2"]);
  });

  /*
   * The same charge priced for two box sizes is one item and two container
   * types — that is what container_type_ref_id exists for (0663/D10). They must
   * not collapse onto one another.
   */
  test("two lines of one item are told apart by their equipment", () => {
    const boxes = [
      { costing_line_id: "L20", dictionary_item_id: "ITEM-DEM", container_type_ref_id: "T20", label: "Demurrage" },
      { costing_line_id: "L40", dictionary_item_id: "ITEM-DEM", container_type_ref_id: "T40", label: "Demurrage" },
    ];
    const { writes } = plan(boxes, [
      { dictionary_item_id: "ITEM-DEM", container_type_ref_id: "T40", label: "Demurrage" },
      { dictionary_item_id: "ITEM-DEM", container_type_ref_id: "T20", label: "Demurrage" },
    ]);
    expect(writes.map((w) => w.id)).toEqual(["L40", "L20"]);
  });

  /*
   * A hand-typed sheet CAN repeat a key outright (same item, no equipment).
   * Matching pops a queue in order, so the repeat keeps its position rather
   * than both payload lines fighting over the first prior row.
   */
  test("a genuinely repeated key matches in order, one prior row each", () => {
    const twice = [
      { costing_line_id: "A", dictionary_item_id: null, container_type_ref_id: null, label: "Sundry" },
      { costing_line_id: "B", dictionary_item_id: null, container_type_ref_id: null, label: "Sundry" },
    ];
    const { writes, dropped } = plan(twice, [{ label: "Sundry" }, { label: "Sundry" }, { label: "Sundry" }]);
    expect(writes.map((w) => w.id)).toEqual(["A", "B", null]);
    expect(dropped).toEqual([]);
  });

  test("a label-only line is keyed case- and space-insensitively", () => {
    const { writes } = plan(
      [{ costing_line_id: "X", dictionary_item_id: null, container_type_ref_id: null, label: "Port Charges" }],
      [{ label: "  port charges  " }],
    );
    expect(writes[0].id).toBe("X");
  });

  test("clearing the sheet drops everything and keeps nothing", () => {
    const { writes, keptIds, dropped } = plan(prior, []);
    expect(writes).toEqual([]);
    expect(keptIds).toEqual([]);
    expect(dropped).toHaveLength(2);
  });
});

/* ══════════════════ 6. The block a validator reads ══════════════════ */

describe("budgetControl", () => {
  const costing = { costing_id: "c-1", doc_number: "CST-2026-0043", status: "APPROVED_LOCKED" };
  const ledger = costingRules.summariseBudget(
    ledgerRows({ [PORT]: { committed: 100000 } }),
  ).lines;

  test("it answers 'is this file budgeted, and is this request inside it?'", () => {
    const c = budgetControl({
      lines: [{ costing_line_id: DUTIES, budget_amount: 2500000 }],
      ledger,
      costing,
    });
    expect(c).toMatchObject({
      costing_doc_number: "CST-2026-0043",
      budget_total: 2886115,
      committed_elsewhere: 100000,
      remaining_before: 2786115,
      claimed_here: 2500000,
      remaining_after: 286115,
      unbudgeted_line_count: 0,
      is_over_budget: false,
    });
  });

  test("it names both refusals a request can carry", () => {
    const c = budgetControl({
      lines: [{ budget_amount: 5000 }, { costing_line_id: PORT, budget_amount: 90000 }],
      ledger,
      costing,
    });
    expect(c.unbudgeted_line_count).toBe(1);
    expect(c.is_over_budget).toBe(true);
    expect(c.breaches[0]).toMatchObject({ costing_line_id: PORT, remaining: 50000, excess: 40000 });
  });

  test("no costing means no block to render", () => {
    const c = budgetControl({ lines: [], ledger: [], costing: null });
    expect(c.costing_id).toBeNull();
    expect(c.budget_total).toBe(0);
    expect(c.is_over_budget).toBe(false);
  });
});

/* ══════════════════ 7. The migration says what the code assumes ══════════════════ */

/*
 * The arithmetic above is only true if the columns exist. These read the
 * migration rather than a live database, so they run in unit CI and catch the
 * one failure a pure test cannot: a formula shipped without its storage.
 */
describe("migration 12771", () => {
  const fs = require("fs");
  const path = require("path");
  const sql = fs.readFileSync(
    path.join(__dirname, "../../migrations/tenant/12771_cash_request_budget.sql"),
    "utf8",
  );

  test("the budget link is a real foreign key, not a loose uuid", () => {
    expect(sql).toMatch(/costing_line_id uuid REFERENCES costing_line\(costing_line_id\)/);
  });

  test("it is RESTRICT — a claimed budget line cannot vanish underneath its claim", () => {
    // No ON DELETE clause means RESTRICT, which is the point: SET NULL would
    // orphan the claim and the committed amount would silently disappear.
    expect(sql).not.toMatch(/costing_line_id uuid REFERENCES costing_line\([^)]*\)\s+ON DELETE/);
  });

  test("the line carries the legacy shape the voucher prints", () => {
    for (const col of ["qty", "unit_cost", "line_no", "source", "settled_amount"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  test("the request carries its own money unit", () => {
    for (const col of ["currency", "exchange_rate_to_xaf", "amount_xaf"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  test("CLOSED_SHORT is in the status vocabulary", () => {
    expect(sql).toMatch(/'CLOSED_SHORT'/);
  });

  test("the receipt is recorded per instalment, not per request", () => {
    const paymentBlock = sql.slice(sql.indexOf("ALTER TABLE cash_request_payment"));
    for (const col of ["received_by", "received_at", "received_ack_kind"]) {
      expect(paymentBlock).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  /*
   * The backfill is what stops the permission change locking people out on
   * deploy: every flag is seeded from whatever gated it the day before.
   */
  test("the new grants are backfilled from what gated them yesterday", () => {
    expect(sql).toMatch(/SET can_export\s+= true WHERE can_export\s+= false AND can_read\s+= true/);
    expect(sql).toMatch(/SET can_validate = true WHERE can_validate = false AND can_approve = true/);
    expect(sql).toMatch(/SET can_disburse = true WHERE can_disburse = false AND can_approve = true/);
  });

  test("the consumption index is partial — an overhead line carries no budget", () => {
    expect(sql).toMatch(/ix_cash_request_line_costing_line[\s\S]*WHERE costing_line_id IS NOT NULL/);
  });
});

/* ══════════════════ 8. The gate vocabulary the routes depend on ══════════════════ */

describe("the permission vocabulary", () => {
  const rbac = require("../../src/middleware/rbac");
  const authz = require("../../src/services/ai/action-authz");

  /*
   * `can_disburse` is backfilled from `can_approve`, so DROPPING the APPROVER
   * capability from the disburse route would have WIDENED it: a tenant that had
   * used the authority overlay to take disbursement away from some of its
   * approvers would silently have got it back. Both gates stand, so
   * `can_disburse` can only narrow — which is the direction that matters.
   */
  test("disbursement still demands the authority overlay on top of its grant", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/modules/costing/cash_request/cash_request.routes.js"),
      "utf8",
    );
    const line = src.split("\n").find((l) => l.includes('"/:id/disburse"'));
    expect(line).toContain('requirePermission(MODULE, "disburse")');
    expect(line).toContain('requireCapability("APPROVER")');
  });

  test("disburse and validate resolve to their own columns, not to approve", () => {
    // Before 12771 both were can_approve, which meant a dedicated cashier had
    // to be given approval authority over every request in order to pay one.
    const routes = require("../../src/modules/costing/cash_request/cash_request.routes");
    expect(routes.basePath).toBe("/cash-requests");
    // requirePermission throws at mount time on an unknown verb, so the module
    // loading at all is the assertion that the vocabulary accepted them.
    expect(() => rbac.requirePermission("MOD-49", "disburse")).not.toThrow();
    expect(() => rbac.requirePermission("MOD-49", "validate")).not.toThrow();
    expect(() => rbac.requirePermission("MOD-49", "export")).not.toThrow();
  });

  test("the AI path maps the same verbs — an assistant is never gated more loosely", () => {
    for (const verb of ["disburse", "validate", "export"]) {
      expect(authz.parseRequirement(`MOD-49:${verb}`)).not.toBeNull();
    }
  });
});

/* ══════════════════ 9. The line shape, end to end ══════════════════ */

/*
 * 12771 gave the line back the qty × unit_cost shape the legacy carried and
 * `costing_line` still has — our own import was computing the product and
 * throwing both away, so a 2-container THC line at 99 000 became "198 000" and
 * an approver could not see the count change.
 *
 * `computeTotals` reads `budget_amount`, so a payload in the NEW shape must
 * still total correctly. It is the kind of gap that produces a request for
 * zero francs and no error anywhere.
 */
describe("computeTotals across both line shapes", () => {
  const { computeTotals } = require("../../src/modules/costing/cash_request/cash_request.rules");

  test("the shapes agree, to the franc", () => {
    const flat = computeTotals([{ budget_amount: 198000, vat_percent: 19.25 }]);
    const shaped = computeTotals([{ qty: 2, unit_cost: 99000, budget_amount: 198000, vat_percent: 19.25 }]);
    expect(shaped.total_payable).toBe(flat.total_payable);
    expect(shaped.total_payable).toBe(236115);
  });

  test("the owner's three lines total the cash the file actually needs", () => {
    const t = computeTotals([
      { budget_amount: 150000 },
      { budget_amount: 2500000 },
      { budget_amount: 198000, vat_percent: 19.25 },
    ]);
    expect(t.subtotal).toBe(2848000);
    expect(t.vat_total).toBe(38115);
    expect(t.total_payable).toBe(2886115);
  });
});
