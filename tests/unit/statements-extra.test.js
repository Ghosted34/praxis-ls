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

const { tafire, notesAnnexes, canClosePeriod } = require("../../src/modules/finance/financial_statement/financial_statement.rules");

describe("TAFIRE OHADA sectioning", () => {
  test("opening + operating/investing/financing = closing", () => {
    const t = tafire({ opening_cash: 1000, operating: 500, investing: -300, financing: 200 });
    expect(t.net_change).toBe(400);
    expect(t.closing_cash).toBe(1400);
    expect(t.operating).toBe(500);
    expect(t.investing).toBe(-300);
    expect(t.financing).toBe(200);
  });
  test("handles missing/zero sections and rounds", () => {
    const t = tafire({ opening_cash: 0 });
    expect(t.closing_cash).toBe(0);
    expect(t.net_change).toBe(0);
  });
});

describe("Notes annexes (KB §12)", () => {
  const rows = [
    { account_code: "601", debit: 300000, credit: 0 },
    { account_code: "7061", debit: 0, credit: 2000000 },
    { account_code: "521", debit: 1700000, credit: 0 },
  ];
  test("breaks the trial balance down by SYSCOHADA class and ties to the result", () => {
    const n = notesAnnexes(rows);
    expect(n.class_balances[6]).toBe(300000);
    expect(n.class_balances[7]).toBe(-2000000);
    expect(n.result).toBe(1700000); // produits 2,000,000 − charges 300,000
  });
});

describe("Guided close gate (KB §12 intangibility)", () => {
  test("blocks close when the period does not balance", () => {
    const g = canClosePeriod([{ account_code: "601", debit: 300000, credit: 0 }], "CLOSED");
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/not balanced/);
  });
  test("allows close when Dr = Cr", () => {
    const g = canClosePeriod([
      { account_code: "601", debit: 300000, credit: 0 },
      { account_code: "521", debit: 0, credit: 300000 },
    ], "CLOSED");
    expect(g.ok).toBe(true);
  });
  test("rejects an invalid target status", () => {
    expect(canClosePeriod([], "OPEN").ok).toBe(false);
  });
});
