"use strict";
/** Tax Center (KB §15/§16/§17) — pure, against the ACME worked numbers. */
const { vatReturn, turnoverFrom, corporateTax, withholdingReturn, cnpsSummary, dsfDataset } = require("../../src/modules/finance/tax_declaration/tax_declaration.rules");
const { incomeStatement, balanceSheet } = require("../../src/modules/finance/financial_statement/financial_statement.rules");

describe("VAT return (§16)", () => {
  it("output − input, net due", () => {
    const r = vatReturn([
      { account_code: "4432", debit: 0, credit: 385000 },
      { account_code: "4452", debit: 96250, credit: 0 },
    ]);
    expect(r.output_vat).toBe(385000);
    expect(r.input_vat).toBe(96250);
    expect(r.vat_due).toBe(288750);
  });
  it("net credit carried forward when input exceeds output", () => {
    const r = vatReturn([{ account_code: "4432", debit: 0, credit: 100000 }, { account_code: "445", debit: 150000, credit: 0 }]);
    expect(r.vat_due).toBe(0);
    expect(r.vat_credit).toBe(50000);
  });
});

describe("turnover (débours excluded)", () => {
  it("sums class 70 credit balances only", () => {
    expect(turnoverFrom([
      { account_code: "7061", debit: 0, credit: 1500000 },
      { account_code: "7062", debit: 0, credit: 500000 },
      { account_code: "4731", debit: 0, credit: 8000000 }, // débours — not class 7
    ])).toBe(2000000);
  });
});

describe("corporate tax (§15)", () => {
  it("minimum tax (2.2% of turnover) is due even at a loss", () => {
    const r = corporateTax({ result: -500000, turnover: 2000000 });
    expect(r.minimum_tax).toBe(44000);
    expect(r.tax_due).toBe(44000);
    expect(r.basis).toBe("MINIMUM_TAX");
  });
  it("IS (33%) applies when it exceeds the minimum", () => {
    const r = corporateTax({ result: 800000, turnover: 2000000 });
    expect(r.is_on_profit).toBe(264000);
    expect(r.tax_due).toBe(264000);
    expect(r.basis).toBe("IS");
  });
});

describe("withholding return (§17)", () => {
  it("447 credit balance is payable to remit; 449 debit balance is précompte suffered", () => {
    const r = withholdingReturn([
      { account_code: "4474", debit: 0, credit: 44000 },   // WHT withheld from suppliers → remit
      { account_code: "4471", debit: 0, credit: 120000 },  // IRPP+CAC on salaries → remit
      { account_code: "4492", debit: 44000, credit: 0 },   // précompte suffered → receivable
    ]);
    expect(r.withheld_payable).toBe(164000);
    expect(r.precompte_suffered).toBe(44000);
    expect(r.net_remittance).toBe(164000);
  });
});

describe("CNPS declaration (§9)", () => {
  it("summarises per-employee social base + employee/employer contributions", () => {
    const items = [
      { employee_name: "A", cnps_number: "111", gross: 500000, breakdown: { employee: { cnps_pension: 21000 }, employer: { pension: 21000, family: 35000, injury: 8750 } } },
      { employee_name: "B", cnps_number: "222", gross: 900000, breakdown: { employee: { cnps_pension: 31500 }, employer: { pension: 31500, family: 52500, injury: 15750 } } },
    ];
    const r = cnpsSummary(items);
    expect(r.headcount).toBe(2);
    expect(r.lines[0].cnps_base).toBe(500000);      // under ceiling
    expect(r.lines[1].cnps_base).toBe(750000);      // capped at ceiling
    expect(r.totals.employee_pension).toBe(52500);  // 21000 + 31500
    expect(r.totals.total).toBe(217000);            // sum of all four contribution streams
  });
  it("empty period yields a zeroed declaration", () => {
    const r = cnpsSummary([]);
    expect(r.headcount).toBe(0);
    expect(r.totals.total).toBe(0);
  });
});

describe("DSF dataset (§15)", () => {
  it("groups the trial balance by SYSCOHADA class and carries the statements", () => {
    const rows = [
      { account_code: "601", debit: 300000, credit: 0 },
      { account_code: "7061", debit: 0, credit: 2000000 },
      { account_code: "521", debit: 1700000, credit: 0 },
      { account_code: "4432", debit: 0, credit: 385000 },
    ];
    const cr = incomeStatement(rows);
    const bs = balanceSheet(rows, cr.result);
    const r = dsfDataset(rows, { incomeStatement: cr, balanceSheet: bs });
    expect(r.format).toBe("OHADA_SYSCOHADA");
    expect(r.classes[7].balance).toBe(-2000000);    // credit-positive turnover
    expect(r.classes[6].balance).toBe(300000);
    expect(r.income_statement.result).toBe(cr.result);
  });
});
