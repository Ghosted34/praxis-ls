"use strict";
/** Pure invoicing math (KB §8.1/§8.3) — totals + advance application. */
const {
  computeTotals,
  applyAdvances,
} = require("../../src/services/accounting/invoicing.rules");

describe("computeTotals", () => {
  it("splits service HT / VAT / débours / TTC (ACME §24)", () => {
    const t = computeTotals([
      { amount: 1500000, taxRate: 19.25 },
      { amount: 500000, taxRate: 19.25 },
      { amount: 8000000, isDisbursement: true },
    ]);
    expect(t.service_ht).toBe(2000000);
    expect(t.vat_total).toBe(385000);
    expect(t.disbursement_total).toBe(8000000);
    expect(t.total_ttc).toBe(10385000);
  });
  it("no VAT on débours", () => {
    const t = computeTotals([{ amount: 1000000, isDisbursement: true }]);
    expect(t.vat_total).toBe(0);
    expect(t.total_ttc).toBe(1000000);
  });
});

describe("applyAdvances (FIFO)", () => {
  it("applies a 10M advance to a 10.385M invoice, leaving 385k due (§8.3)", () => {
    const r = applyAdvances(10385000, [
      { advance_id: "a1", amount: 10000000, applied_amount: 0 },
    ]);
    expect(r.applied_total).toBe(10000000);
    expect(r.net_due).toBe(385000);
    expect(r.allocations).toEqual([{ advance_id: "a1", amount: 10000000 }]);
  });
  it("stops at the invoice total when advances exceed it", () => {
    const r = applyAdvances(1000000, [
      { advance_id: "a1", amount: 800000 },
      { advance_id: "a2", amount: 500000 },
    ]);
    expect(r.applied_total).toBe(1000000);
    expect(r.net_due).toBe(0);
    expect(r.allocations).toEqual([
      { advance_id: "a1", amount: 800000 },
      { advance_id: "a2", amount: 200000 },
    ]);
  });
  it("skips fully-applied advances", () => {
    const r = applyAdvances(500000, [
      { advance_id: "a1", amount: 400000, applied_amount: 400000 },
      { advance_id: "a2", amount: 500000 },
    ]);
    expect(r.applied_total).toBe(500000);
    expect(r.allocations).toEqual([{ advance_id: "a2", amount: 500000 }]);
  });
});
