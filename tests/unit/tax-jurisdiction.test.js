"use strict";
const {
  assertRate,
  assertEffectiveWindow,
  pickEffective,
} = require("../../src/modules/master/tax_jurisdiction/tax_jurisdiction.rules");

describe("tax jurisdiction rules (MOD-07)", () => {
  test("rate kinds need a rate or brackets", () => {
    expect(assertRate({ kind: "VAT", ratePercent: 19.25 })).toBe(true);
    expect(
      assertRate({ kind: "INCOME", brackets: [{ upto: 1000, rate: 10 }] }),
    ).toBe(true);
    expect(() => assertRate({ kind: "VAT" })).toThrow();
    expect(() => assertRate({ kind: "VAT", ratePercent: 150 })).toThrow();
    expect(assertRate({ kind: "OTHER" })).toBe(true); // non-rate kind exempt
  });
  test("effective window must be ordered", () => {
    expect(
      assertEffectiveWindow({
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      }),
    ).toBe(true);
    expect(
      assertEffectiveWindow({ effectiveFrom: "2026-01-01", effectiveTo: null }),
    ).toBe(true);
    expect(() =>
      assertEffectiveWindow({
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-01-01",
      }),
    ).toThrow();
  });
  test("pickEffective returns the row effective at the date", () => {
    const rows = [
      {
        rate_percent: 19.25,
        effective_from: "2020-01-01",
        effective_to: "2025-12-31",
      },
      { rate_percent: 20, effective_from: "2026-01-01", effective_to: null },
    ];
    expect(pickEffective(rows, "2026-06-01").rate_percent).toBe(20);
    expect(pickEffective(rows, "2022-06-01").rate_percent).toBe(19.25);
    expect(() => pickEffective(rows, "2019-01-01")).toThrow();
  });
});
