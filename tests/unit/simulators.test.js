"use strict";
const {
  computeMargin,
  priceForMargin,
} = require("../../src/modules/commercial/margin_simulation/margin_simulation.rules");
const {
  computeDemurrage,
  daysBetween,
} = require("../../src/modules/commercial/extra_charge_simulation/extra_charge_simulation.rules");

describe("margin simulator (MOD-27)", () => {
  test("margin is on services only; débours excluded", () => {
    const r = computeMargin([
      { qty: 1, unit_cost: 100, unit_price: 150 }, // service
      { qty: 2, unit_cost: 50, unit_price: 50, is_disbursement: true }, // pass-through
    ]);
    expect(r.total_cost).toBe(200); // 100 + 2*50
    expect(r.total_price).toBe(250); // 150 + 2*50
    expect(r.service_cost).toBe(100);
    expect(r.service_price).toBe(150);
    expect(r.disbursement_total).toBe(100);
    expect(r.margin_amount).toBe(50);
    expect(r.margin_percent).toBeCloseTo(33.33, 1);
    expect(r.markup_percent).toBe(50);
  });
  test("priceForMargin inverts margin", () => {
    expect(priceForMargin(100, 33.33)).toBeCloseTo(150, 0);
    expect(() => priceForMargin(100, 100)).toThrow();
  });
  test("rejects empty and bad qty", () => {
    expect(() => computeMargin([])).toThrow();
    expect(() =>
      computeMargin([{ qty: 0, unit_cost: 1, unit_price: 2 }]),
    ).toThrow();
  });
});

describe("demurrage simulator (MOD-28)", () => {
  const tiers = [
    { from_day: 1, to_day: 5, rate: 10000 },
    { from_day: 6, to_day: null, rate: 20000 },
  ];
  test("charges only days beyond free period, tiered", () => {
    const r = computeDemurrage({ freeDays: 3, occupiedDays: 8, tiers });
    expect(r.chargeable_days).toBe(5); // days 1..5 chargeable
    expect(r.total_amount).toBe(50000); // 5 days * 10000 (all within tier 1)
    expect(r.breakdown).toHaveLength(5);
  });
  test("crosses tier boundary", () => {
    const r = computeDemurrage({ freeDays: 0, occupiedDays: 7, tiers });
    // days 1-5 @10000 = 50000, days 6-7 @20000 = 40000
    expect(r.total_amount).toBe(90000);
    expect(r.chargeable_days).toBe(7);
  });
  test("no chargeable days when within free period", () => {
    const r = computeDemurrage({ freeDays: 10, occupiedDays: 4, tiers });
    expect(r.chargeable_days).toBe(0);
    expect(r.total_amount).toBe(0);
  });
  test("daysBetween counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(daysBetween("2026-01-08", "2026-01-01")).toBe(0);
  });
  test("throws on tariff gap", () => {
    expect(() =>
      computeDemurrage({
        freeDays: 0,
        occupiedDays: 3,
        tiers: [{ from_day: 2, to_day: 5, rate: 1 }],
      }),
    ).toThrow();
  });
});
