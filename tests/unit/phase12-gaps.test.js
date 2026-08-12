"use strict";
const ta = require("../../src/modules/master/treasury_account/treasury_account.rules");
const er = require("../../src/modules/master/expense_rate/expense_rate.rules");
const cr = require("../../src/modules/costing/cash_request/cash_request.rules");
const debt = require("../../src/modules/finance/debt/debt.rules");

describe("treasury account rules (MOD-09)", () => {
  test("requires class-5 cash account", () => {
    expect(ta.assertCashAccount("521")).toBe(true);
    expect(() => ta.assertCashAccount("411")).toThrow();
    expect(() => ta.assertCashAccount("")).toThrow();
  });
  test("MoMo needs a network and class-6 fee account", () => {
    expect(ta.assertMomo({ kind: "BANK" })).toBe(true);
    expect(() => ta.assertMomo({ kind: "MOMO" })).toThrow();
    expect(
      ta.assertMomo({
        kind: "MOMO",
        momoNetwork: "MTN",
        momoFeeAccount: "631",
      }),
    ).toBe(true);
    expect(() =>
      ta.assertMomo({
        kind: "MOMO",
        momoNetwork: "MTN",
        momoFeeAccount: "411",
      }),
    ).toThrow();
  });
});

describe("expense rate resolver (MOD-10)", () => {
  const MAERSK = "11111111-1111-1111-1111-111111111111";
  const FT40 = "22222222-2222-2222-2222-222222222222";
  const rows = [
    {
      rate: 100,
      effective_from: "2026-01-01",
      effective_to: null,
      rate_provider_id: null,
      container_type_ref_id: null,
    },
    {
      rate: 120,
      effective_from: "2026-01-01",
      effective_to: null,
      rate_provider_id: MAERSK,
      container_type_ref_id: FT40,
    },
    {
      rate: 90,
      effective_from: "2020-01-01",
      effective_to: "2021-01-01",
      rate_provider_id: null,
      container_type_ref_id: null,
    },
  ];
  test("most specific effective match wins, cascading down to the default", () => {
    expect(
      er.pickRate(rows, {
        date: "2026-06-01",
        rateProviderId: MAERSK,
        containerTypeRefId: FT40,
      }).rate,
    ).toBe(120);
    expect(er.pickRate(rows, { date: "2026-06-01" }).rate).toBe(100);
  });
  test("a row scoped to one carrier never answers a different carrier's request", () => {
    const OTHER = "33333333-3333-3333-3333-333333333333";
    expect(
      er.pickRate(rows, {
        date: "2026-06-01",
        rateProviderId: OTHER,
        containerTypeRefId: FT40,
      }).rate,
    ).toBe(100);
  });
  test("throws when nothing effective", () => {
    expect(() => er.pickRate(rows, { date: "2015-01-01" })).toThrow();
  });
});

describe("cash request lifecycle (MOD-49)", () => {
  test("valid + invalid transitions", () => {
    expect(cr.assertTransition("DRAFT", "SUBMITTED")).toBe(true);
    expect(cr.assertTransition("APPROVED", "DISBURSED")).toBe(true);
    expect(() => cr.assertTransition("DRAFT", "DISBURSED")).toThrow();
  });
  test("sumField", () => {
    expect(
      cr.sumField(
        [{ budget_amount: 10 }, { budget_amount: 5.5 }],
        "budget_amount",
      ),
    ).toBe(15.5);
  });
});

describe("debt posting lines balance (MOD-53)", () => {
  test("drawdown Dr treasury / Cr loan", () => {
    const l = debt.buildDrawdownLines({
      principal: 1000,
      treasuryCoa: "521",
      loanCoa: "162",
    });
    const dr = l.reduce((s, x) => s + x.debit, 0);
    const crd = l.reduce((s, x) => s + x.credit, 0);
    expect(dr).toBe(1000);
    expect(crd).toBe(1000);
  });
  test("repayment Dr principal+interest / Cr treasury balances", () => {
    const l = debt.buildRepaymentLines({
      principalPart: 800,
      interestPart: 50,
    });
    const dr = l.reduce((s, x) => s + x.debit, 0);
    const crd = l.reduce((s, x) => s + x.credit, 0);
    expect(dr).toBeCloseTo(850, 2);
    expect(crd).toBeCloseTo(850, 2);
    expect(dr).toBeCloseTo(crd, 2);
  });
  test("rejects zero repayment / bad principal", () => {
    expect(() =>
      debt.buildRepaymentLines({ principalPart: 0, interestPart: 0 }),
    ).toThrow();
    expect(() => debt.buildDrawdownLines({ principal: 0 })).toThrow();
  });
});
