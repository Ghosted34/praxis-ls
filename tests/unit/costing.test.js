"use strict";
/** Costing math (KB §6.7): débours excluded from margin; budget vs actual. */
const { computeCosting, reconcile } = require("../../src/modules/costing/costing/costing.rules");

describe("computeCosting", () => {
  const lines = [
    { qty: 1, unit_cost: 1500000, is_debours: false }, // last-mile service
    { qty: 1, unit_cost: 500000, is_debours: false },   // commission service
    { qty: 1, unit_cost: 8000000, is_debours: true },   // customs/port/shipping débours
  ];
  it("splits service vs débours; margin applies to service only (§6.7)", () => {
    const t = computeCosting(lines, 25);
    expect(t.service_cost).toBe(2000000);
    expect(t.debours_total).toBe(8000000);
    expect(t.service_sell_ht).toBe(2500000);   // 2,000,000 * 1.25
    expect(t.margin_amount).toBe(500000);
    expect(t.sell_ht).toBe(10500000);          // service sell + débours pass-through
  });
  it("zero margin = cost", () => {
    const t = computeCosting([{ qty: 2, unit_cost: 100000, is_debours: false }], 0);
    expect(t.service_sell_ht).toBe(200000);
    expect(t.margin_amount).toBe(0);
  });
});

describe("reconcile", () => {
  it("computes variance and over-budget flag", () => {
    const r = reconcile(2000000, 2300000);
    expect(r.variance).toBe(300000);
    expect(r.variance_percent).toBe(15);
    expect(r.over_budget).toBe(true);
  });
  it("under budget", () => {
    expect(reconcile(2000000, 1800000).over_budget).toBe(false);
  });
});
