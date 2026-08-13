"use strict";
/** Statements aggregation (KB §12) — pure, on a self-consistent balanced ledger. */
const {
  trialBalanceTotals,
  incomeStatement,
  balanceSheet,
  classOf,
} = require("../../src/modules/finance/financial_statement/financial_statement.rules");

// Capital 1,000,000 (Cr 101 / Dr 521); sale 2,000,000 (Dr 521 / Cr 706);
// expense 1,200,000 (Dr 6110 / Cr 521). Aggregated trial balance:
const rows = [
  { account_code: "521", debit: 3000000, credit: 1200000 },
  { account_code: "101", debit: 0, credit: 1000000 },
  { account_code: "706", debit: 0, credit: 2000000 },
  { account_code: "6110", debit: 1200000, credit: 0 },
];

describe("statements", () => {
  it("classifies by first digit", () => {
    expect(classOf("521")).toBe(5);
    expect(classOf("6110")).toBe(6);
  });
  it("trial balance is balanced", () => {
    const t = trialBalanceTotals(rows);
    expect(t.debit).toBe(4200000);
    expect(t.credit).toBe(4200000);
    expect(t.balanced).toBe(true);
  });
  it("Compte de résultat: produits 2M - charges 1.2M = result 800k", () => {
    const cr = incomeStatement(rows);
    expect(cr.charges).toBe(1200000);
    expect(cr.produits).toBe(2000000);
    expect(cr.result).toBe(800000);
  });
  it("Bilan balances with the result folded into equity", () => {
    const cr = incomeStatement(rows);
    const b = balanceSheet(rows, cr.result);
    expect(b.active).toBe(1800000); // cash 521
    expect(b.passif).toBe(1800000); // capital 1,000,000 + result 800,000
    expect(b.balanced).toBe(true);
  });
});
