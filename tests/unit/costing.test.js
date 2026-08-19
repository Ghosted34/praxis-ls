"use strict";
/**
 * Costing math (KB §6.7 + §2.2): HT / VAT / TTC and STOP — no margin, no sell
 * price. Legacy costing never had a margin concept (api/costing/save.php has
 * zero margin references; the 54 'margin' hits in view costing-module.php are
 * CSS); margin belongs to margin_simulation + quotation. Débours are
 * pass-through: billed at cost, never taxed.
 */
const {
  computeCosting,
  reconcile,
} = require("../../src/modules/costing/costing/costing.rules");

describe("computeCosting", () => {
  const lines = [
    // last-mile service, VAT 19.25 from its own tax code (joined by the repo)
    {
      qty: 1,
      unit_cost: 1500000,
      is_disbursement: false,
      tax_rate_percent: 19.25,
    },
    // commission service, no tax code → no VAT
    { qty: 1, unit_cost: 500000, is_disbursement: false },
    // customs/port/shipping débours — at cost, never taxed (0640 DB rule)
    { qty: 1, unit_cost: 8000000, is_disbursement: true },
  ];

  it("totals are the legacy footer: Subtotal (HT) / VAT / Total Estimate", () => {
    const t = computeCosting(lines);
    expect(t.service_cost).toBe(2000000);
    expect(t.disbursement_total).toBe(8000000);
    expect(t.total_ht).toBe(10000000);
    expect(t.vat_total).toBe(288750); // 1,500,000 × 19.25%
    expect(t.total_ttc).toBe(10288750);
  });

  it("has NO margin or sell fields (§2.2 — margin is a pricing question)", () => {
    const t = computeCosting(lines);
    for (const gone of [
      "margin_percent",
      "margin_amount",
      "sell_ht",
      "service_sell_ht",
    ]) {
      expect(t).not.toHaveProperty(gone);
    }
  });

  it("VAT applies per line from the line's own rate — nothing hardcoded", () => {
    const t = computeCosting([
      {
        qty: 2,
        unit_cost: 100000,
        is_disbursement: false,
        tax_rate_percent: 10,
      },
      { qty: 1, unit_cost: 50000, is_disbursement: false, tax_rate_percent: 5 },
    ]);
    expect(t.vat_total).toBe(22500); // 200,000×10% + 50,000×5%
    expect(t.total_ttc).toBe(272500);
  });

  it("keeps total_cost for readers that summed the old shape", () => {
    const t = computeCosting(lines);
    expect(t.total_cost).toBe(t.total_ht);
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
