"use strict";
/** Grand livre running balance + cash-flow (TAFIRE) summary. */
const { runningBalance, cashFlowSummary } = require("../../src/modules/finance/financial_statement/financial_statement.rules");
describe("runningBalance", () => {
  it("accumulates debit-positive", () => {
    const r = runningBalance([{ debit: 1000, credit: 0 }, { debit: 0, credit: 400 }, { debit: 200, credit: 0 }], 0);
    expect(r.map((x) => x.balance)).toEqual([1000, 600, 800]);
  });
  it("honours an opening balance", () => {
    expect(runningBalance([{ debit: 0, credit: 500 }], 1000)[0].balance).toBe(500);
  });
});
describe("cashFlowSummary (TAFIRE foundation)", () => {
  it("closing = opening + inflows - outflows", () => {
    const s = cashFlowSummary({ opening_cash: 1000000, inflows: 3000000, outflows: 1200000 });
    expect(s.net_change).toBe(1800000);
    expect(s.closing_cash).toBe(2800000);
  });
});
