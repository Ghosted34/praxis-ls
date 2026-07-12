"use strict";
const { computeVariance, flagFor, salesView } = require("../../src/modules/commercial/pricing_variance/pricing_variance.rules");

describe("Pricing Variance Index (MOD-27)", () => {
  test("margin% = (quote - cost)/quote", () => {
    expect(computeVariance({ quotedPrice: 1000, actualCost: 700 }).margin_percent).toBe(30);
    expect(computeVariance({ quotedPrice: 1000, actualCost: 950 }).margin_percent).toBe(5);
    expect(computeVariance({ quotedPrice: 0, actualCost: 100 }).margin_percent).toBe(-100);
  });
  test("R/Y/G from thresholds (defaults green>=20, yellow>=10)", () => {
    expect(flagFor(30)).toBe("GREEN");
    expect(flagFor(15)).toBe("YELLOW");
    expect(flagFor(5)).toBe("RED");
    expect(flagFor(-100)).toBe("RED");
    // custom thresholds
    expect(flagFor(12, { green_min: 25, yellow_min: 15 })).toBe("RED");
  });
  test("salesView NEVER exposes actual_cost (finance boundary)", () => {
    const full = { pricing_variance_id: "p1", dossier_id: "d1", quotation_id: "q1", quoted_price: 1000, actual_cost: 700, variance_percent: 30, flag: "GREEN", computed_at: "t" };
    const view = salesView(full);
    expect(view.actual_cost).toBeUndefined();
    expect(view.flag).toBe("GREEN");
    expect(view.quoted_price).toBe(1000);
    expect(Object.keys(view)).not.toContain("actual_cost");
  });
});
