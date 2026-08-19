"use strict";

/**
 * Pricing Variance Index (MOD-27) — §2.1: the index is a DERIVED projection
 * over the dossier reconciliation. These tests pin the projection maths, the
 * R/Y/G thresholds, and above all the Sales/Finance boundary: the Sales view
 * must never carry a cost figure (budget_ht / actual_ht), because Sales seeing
 * margin % and flag WITHOUT cost is a real permission split, not cosmetics.
 */
const {
  computeVariance,
  flagFor,
  projectRow,
  salesView,
} = require("../../src/modules/commercial/pricing_variance/pricing_variance.rules");

describe("Pricing Variance Index (MOD-27)", () => {
  test("margin% = (quote - cost)/quote", () => {
    expect(
      computeVariance({ quotedPrice: 1000, actualCost: 700 }).margin_percent,
    ).toBe(30);
    expect(
      computeVariance({ quotedPrice: 1000, actualCost: 950 }).margin_percent,
    ).toBe(5);
    expect(
      computeVariance({ quotedPrice: 0, actualCost: 100 }).margin_percent,
    ).toBe(-100);
  });

  test("R/Y/G from thresholds (defaults green>=20, yellow>=10)", () => {
    expect(flagFor(30)).toBe("GREEN");
    expect(flagFor(15)).toBe("YELLOW");
    expect(flagFor(5)).toBe("RED");
    expect(flagFor(-100)).toBe("RED");
    // custom thresholds
    expect(flagFor(12, { green_min: 25, yellow_min: 15 })).toBe("RED");
  });

  test("projectRow answers the three questions from one reconciliation row", () => {
    const row = projectRow({
      reconciliation_id: "r1",
      dossier_id: "d1",
      quotation_id: "q1",
      status: "VALIDATED",
      quoted_ht: 1000,
      budget_ht: 800,
      actual_ht: 700,
      created_at: "t0",
      validated_at: "t1",
    });
    // Q1 — did we quote it right?
    expect(row.quote_vs_budget).toBe(200);
    // Q2 — did we execute to plan?
    expect(row.budget_vs_actual).toBe(100);
    // Q3 — did we make money?
    expect(row.quote_vs_actual).toBe(300);
    expect(row.variance_percent).toBe(30);
    expect(row.flag).toBe("GREEN");
    expect(row.computed_at).toBe("t1"); // validated wins over created
  });

  test("no accepted quotation → execution answer only, flag null (not a fake RED)", () => {
    const row = projectRow({
      reconciliation_id: "r1",
      dossier_id: "d1",
      quotation_id: null,
      status: "DRAFT",
      quoted_ht: null,
      budget_ht: 800,
      actual_ht: 900,
      created_at: "t0",
      validated_at: null,
    });
    expect(row.budget_vs_actual).toBe(-100);
    expect(row.quote_vs_budget).toBeNull();
    expect(row.quote_vs_actual).toBeNull();
    expect(row.variance_percent).toBeNull();
    expect(row.flag).toBeNull();
  });

  test("salesView NEVER exposes budget/actual cost (finance boundary)", () => {
    const full = projectRow({
      reconciliation_id: "r1",
      dossier_id: "d1",
      quotation_id: "q1",
      status: "VALIDATED",
      quoted_ht: 1000,
      budget_ht: 800,
      actual_ht: 700,
      created_at: "t0",
      validated_at: "t1",
    });
    const view = salesView(full);
    expect(view.flag).toBe("GREEN");
    expect(view.quoted_ht).toBe(1000);
    expect(view.variance_percent).toBe(30);
    const keys = Object.keys(view);
    // Every cost-bearing field must be absent — not null, ABSENT.
    for (const leak of [
      "actual_ht",
      "budget_ht",
      "actual_cost",
      "budget_vs_actual",
      "quote_vs_budget",
      "quote_vs_actual",
    ]) {
      expect(keys).not.toContain(leak);
    }
  });
});
