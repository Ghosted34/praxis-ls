"use strict";
const prRules = require("../../src/modules/procurement/purchase_request/purchase_request.rules");
const poRules = require("../../src/modules/procurement/purchase_order/purchase_order.rules");
const si = require("../../src/modules/procurement/supplier_invoice/supplier_invoice.rules");

describe("PR lifecycle", () => {
  test("valid + invalid transitions", () => {
    expect(prRules.assertTransition("DRAFT", "SUBMITTED")).toBe(true);
    expect(prRules.assertTransition("SUBMITTED", "APPROVED")).toBe(true);
    expect(() => prRules.assertTransition("DRAFT", "APPROVED")).toThrow();
    expect(() => prRules.assertTransition("REJECTED", "ORDERED")).toThrow();
  });
});

describe("PO totals + lifecycle", () => {
  test("computeTotal sums qty*price", () => {
    expect(
      poRules.computeTotal([
        { qty: 2, unit_price: 100 },
        { qty: 1, unit_price: 50.5 },
      ]),
    ).toBe(250.5);
  });
  test("rejects empty / bad qty", () => {
    expect(() => poRules.computeTotal([])).toThrow();
    expect(() => poRules.computeTotal([{ qty: 0, unit_price: 1 }])).toThrow();
  });
  test("transition guard", () => {
    expect(poRules.assertTransition("DRAFT", "ISSUED_LOCKED")).toBe(true);
    expect(() => poRules.assertTransition("DRAFT", "RECEIVED")).toThrow();
  });
});

describe("supplier invoice three-way match", () => {
  test("matches within tolerance with GRN present", () => {
    const r = si.matchThreeWay({
      poTotal: 1000,
      invoiceTotalHt: 1000,
      grnExists: true,
      tolerancePercent: 0,
    });
    expect(r.matched).toBe(true);
    expect(r.variance_percent).toBe(0);
  });
  test("fails when no GRN", () => {
    const r = si.matchThreeWay({
      poTotal: 1000,
      invoiceTotalHt: 1000,
      grnExists: false,
    });
    expect(r.matched).toBe(false);
    expect(r.reasons.join()).toMatch(/goods-received/);
  });
  test("fails when variance exceeds tolerance", () => {
    const r = si.matchThreeWay({
      poTotal: 1000,
      invoiceTotalHt: 1100,
      grnExists: true,
      tolerancePercent: 5,
    });
    expect(r.variance_percent).toBe(10);
    expect(r.matched).toBe(false);
  });
});

describe("supplier invoice posting lines balance", () => {
  test("Dr expense + VAT, Cr supplier net of WHT + WHT", () => {
    const built = si.buildPostingLines({
      lines: [{ expense_account: "601", qty: 1, unit_price: 1000 }],
      vatTotal: 192.5,
      whtTotal: 50,
      supplierAccount: "4011",
    });
    const debit = built.lines.reduce((s, l) => s + l.debit, 0);
    const credit = built.lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBeCloseTo(1192.5, 2); // 1000 expense + 192.5 VAT
    expect(credit).toBeCloseTo(1192.5, 2); // 1142.5 supplier + 50 WHT
    expect(debit).toBeCloseTo(credit, 2);
    expect(built.amount_ht).toBe(1000);
    expect(built.amount_ttc).toBe(1192.5);
    const supplier = built.lines.find((l) => l.account_code === "4011");
    expect(supplier.credit).toBeCloseTo(1142.5, 2);
  });
  test("rejects line without expense account", () => {
    expect(() =>
      si.buildPostingLines({ lines: [{ qty: 1, unit_price: 100 }] }),
    ).toThrow();
  });
});
