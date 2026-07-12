"use strict";
const { assertTransition, computeTotals } = require("../../src/modules/commercial/quotation/quotation.rules");

describe("Quotation (MOD-27)", () => {
  test("lifecycle transitions", () => {
    expect(assertTransition("DRAFT", "SENT")).toBe(true);
    expect(assertTransition("SENT", "ACCEPTED")).toBe(true);
    expect(assertTransition("ACCEPTED", "CONVERTED")).toBe(true);
    expect(() => assertTransition("DRAFT", "ACCEPTED")).toThrow();
    expect(() => assertTransition("REJECTED", "SENT")).toThrow();
  });
  test("totals: VAT only on taxed non-débours lines", () => {
    const t = computeTotals([
      { qty: 1, unit_price: 1000, tax_code_id: "vat", is_debours: false }, // taxed service
      { qty: 2, unit_price: 100, tax_code_id: null, is_debours: false },   // untaxed
      { qty: 1, unit_price: 500, tax_code_id: "vat", is_debours: true },   // débours: no VAT
    ], 19.25);
    expect(t.total_ht).toBe(1700);            // 1000 + 200 + 500
    expect(t.vat_total).toBe(192.5);          // 19.25% of 1000 only
    expect(t.total_ttc).toBe(1892.5);
  });
  test("zero-VAT when nothing taxed", () => {
    const t = computeTotals([{ qty: 3, unit_price: 100 }], 19.25);
    expect(t.total_ht).toBe(300);
    expect(t.vat_total).toBe(0);
    expect(t.total_ttc).toBe(300);
  });
});
