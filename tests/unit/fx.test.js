"use strict";
/** FX resolver (MOD-08): identity, newest-on-or-before, override precedence, convert. */
const { pickRate, convert } = require("../../src/modules/master/currency/currency.rules");

const R = (base, quote, rate, date, is_override = false) => ({ base_code: base, quote_code: quote, rate, as_of_date: date, is_override });

describe("pickRate", () => {
  it("identity for same currency", () => {
    expect(pickRate([], "XAF", "XAF", "2026-02-01").rate).toBe(1);
  });
  it("picks the newest rate on or before the date", () => {
    const rows = [R("USD", "XAF", 600, "2026-01-01"), R("USD", "XAF", 620, "2026-01-15"), R("USD", "XAF", 999, "2026-03-01")];
    expect(pickRate(rows, "USD", "XAF", "2026-02-01").rate).toBe(620);
  });
  it("prefers a manual override on the same date", () => {
    const rows = [R("USD", "XAF", 620, "2026-01-15", false), R("USD", "XAF", 615, "2026-01-15", true)];
    expect(pickRate(rows, "USD", "XAF", "2026-01-20").rate).toBe(615);
  });
  it("returns null when no rate is known", () => {
    expect(pickRate([], "USD", "XAF", "2026-02-01")).toBeNull();
  });
});

describe("convert", () => {
  it("multiplies and rounds to 2dp", () => {
    expect(convert(1000, R("USD", "XAF", 615.5, "2026-01-15"))).toBe(615500);
  });
  it("null rate → null", () => {
    expect(convert(1000, null)).toBeNull();
  });
});
