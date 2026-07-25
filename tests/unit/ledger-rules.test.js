"use strict";

/**
 * Pure ledger invariants (KB §23) — the app-layer pre-checks in
 * finance/journal_entry/journal_entry.rules. DB triggers (0220/0221/0464) are the
 * final authority; these lock the friendly-error behaviour and the money math.
 */

const { assertBalanced, assertNoCompensation, toMinor } = require("../../src/modules/finance/journal_entry/journal_entry.rules");

const L = (account_code, debit, credit) => ({ account_code, debit, credit });

describe("assertBalanced (§23.1/§23.2)", () => {
  it("accepts a balanced two-line entry", () => {
    expect(() => assertBalanced([L("521", 1000, 0), L("4191", 0, 1000)])).not.toThrow();
  });

  it("rejects an unbalanced entry", () => {
    expect(() => assertBalanced([L("521", 1000, 0), L("4191", 0, 999)])).toThrow(/not balanced/i);
  });

  it("rejects a line with both sides > 0 (§23.2)", () => {
    expect(() => assertBalanced([L("521", 100, 100), L("4191", 0, 100)])).toThrow(/one of debit\/credit/i);
  });

  it("rejects a line with neither side > 0", () => {
    expect(() => assertBalanced([L("521", 0, 0), L("4191", 0, 0)])).toThrow(/one of debit\/credit/i);
  });

  it("requires at least two lines", () => {
    expect(() => assertBalanced([L("521", 1000, 0)])).toThrow(/two lines/i);
  });

  it("rejects a missing account_code", () => {
    expect(() => assertBalanced([{ debit: 1000, credit: 0 }, L("4191", 0, 1000)])).toThrow(/account_code/i);
  });

  it("rejects more than 2 decimals (money precision)", () => {
    expect(() => assertBalanced([L("521", 10.001, 0), L("4191", 0, 10.001)])).toThrow(/2 decimals/i);
  });

  it("sums in minor units without float drift", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float; must still balance to 0.30.
    expect(() => assertBalanced([L("521", 0.1, 0), L("571", 0.2, 0), L("4191", 0, 0.3)])).not.toThrow();
  });
});

describe("assertNoCompensation (§23.6)", () => {
  it("accepts distinct debit/credit accounts", () => {
    expect(() => assertNoCompensation([L("521", 1000, 0), L("4191", 0, 1000)])).not.toThrow();
  });

  it("rejects the same account on both sides of one entry", () => {
    expect(() => assertNoCompensation([L("521", 1000, 0), L("521", 0, 400), L("4191", 0, 600)])).toThrow(/both debited and credited/i);
  });
});

describe("toMinor", () => {
  it("rejects negatives and non-numbers", () => {
    expect(() => toMinor(-1, "x")).toThrow(/non-negative/i);
    expect(() => toMinor("5", "x")).toThrow(/non-negative/i);
  });
  it("converts to centimes", () => {
    expect(toMinor(19.25, "x")).toBe(1925);
  });
});
