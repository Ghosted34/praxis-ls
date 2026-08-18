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

describe("PO totals with VAT (10720)", () => {
  test("computeTotals splits HT / VAT / TTC per line tax rate", () => {
    const t = poRules.computeTotals(
      [
        { dictionary_item_id: "a", qty: 2, unit_price: 100 },
        { dictionary_item_id: "b", qty: 1, unit_price: 200 },
      ],
      (id) => (id === "a" ? 19.25 : 0),
    );
    expect(t.total_ht).toBe(400);
    expect(t.total_vat).toBe(38.5); // 2 × 100 × 19.25%
    expect(t.total_ttc).toBe(438.5);
  });
  test("a line without a tax code is HT-only, never assumed 19.25%", () => {
    const t = poRules.computeTotals([{ qty: 1, unit_price: 1000 }], () => 0);
    expect(t).toEqual({ total_ht: 1000, total_vat: 0, total_ttc: 1000 });
  });
  test("netPayable = TTC − withholding (air % of HT) − advance", () => {
    expect(
      poRules.netPayable({ total_ttc: 1192.5, total_ht: 1000, air_rate: 5, adv_paid: 100 }),
    ).toBe(1042.5); // 1192.5 − 50 − 100
  });
  test("dueOn = delivery + pay days", () => {
    expect(poRules.dueOn("2026-08-05", 14)).toBe("2026-08-19");
    expect(poRules.dueOn("2026-08-05", 0)).toBe(null);
    expect(poRules.dueOn(null, 14)).toBe(null);
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
  test("old-style calls still work — no PR/qty/currency inputs", () => {
    const r = si.matchThreeWay({ poTotal: 1000, invoiceTotalHt: 1000, grnExists: true });
    expect(r.matched).toBe(true);
  });
});

describe("three-way match — PR ↔ PO ↔ GRN ↔ invoice (10720)", () => {
  const base = {
    poTotal: 1000,
    invoiceTotalHt: 1000,
    grnExists: true,
    poLines: [{ dictionary_item_id: "a", label: "Ciment", qty: 10 }],
    grnLines: [{ dictionary_item_id: "a", label: "Ciment", qty: 10 }],
    invoiceLines: [{ dictionary_item_id: "a", label: "Ciment", qty: 10 }],
    poCurrency: "XAF",
    invoiceCurrency: "XAF",
  };
  test("matches when PR, qty and currency all agree", () => {
    const r = si.matchThreeWay({ ...base, prTotal: 1000 });
    expect(r.matched).toBe(true);
  });
  test("PR total far from the PO is a reason, not a silent pass", () => {
    const r = si.matchThreeWay({ ...base, prTotal: 1500, tolerancePercent: 0 });
    expect(r.matched).toBe(false);
    expect(r.reasons.join()).toMatch(/purchase-request total/);
  });
  test("invoicing more than was received fails by quantity", () => {
    const r = si.matchThreeWay({
      ...base,
      grnLines: [{ dictionary_item_id: "a", label: "Ciment", qty: 8 }],
      invoiceLines: [{ dictionary_item_id: "a", label: "Ciment", qty: 10 }],
    });
    expect(r.matched).toBe(false);
    expect(r.reasons.join()).toMatch(/invoiced qty 10 exceeds received 8/);
  });
  test("receiving more than was ordered fails by quantity", () => {
    const r = si.matchThreeWay({
      ...base,
      grnLines: [{ dictionary_item_id: "a", label: "Ciment", qty: 12 }],
    });
    expect(r.matched).toBe(false);
    expect(r.reasons.join()).toMatch(/over-received/);
  });
  test("currency mismatch is refused even when amounts agree", () => {
    const r = si.matchThreeWay({ ...base, invoiceCurrency: "EUR" });
    expect(r.matched).toBe(false);
    expect(r.reasons.join()).toMatch(/currency mismatch/);
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

describe("supplier invoice AP payment (10720)", () => {
  test("buildPaymentLines is Dr supplier / Cr treasury and balanced", () => {
    const lines = si.buildPaymentLines({ amount: 1000, supplierAccount: "4011", treasuryAccount: "5211" });
    expect(lines[0]).toEqual({ account_code: "4011", debit: 1000, credit: 0 });
    expect(lines[1]).toEqual({ account_code: "5211", debit: 0, credit: 1000 });
  });
  test("rejects zero amount and missing treasury account", () => {
    expect(() => si.buildPaymentLines({ amount: 0, treasuryAccount: "5211" })).toThrow();
    expect(() => si.buildPaymentLines({ amount: 100 })).toThrow();
  });
  test("payState derives PAID only when payments cover the invoice", () => {
    expect(si.payState(1000, 0)).toBe("POSTED_LOCKED");
    expect(si.payState(1000, 400)).toBe("POSTED_LOCKED");
    expect(si.payState(1000, 1000)).toBe("PAID");
  });
  test("over-payment is refused, not clamped", () => {
    expect(() => si.payState(1000, 1000.01)).toThrow();
  });
});
