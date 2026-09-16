"use strict";

/**
 * `cost_entry` net-of-reversals read rule (MOD-76 PR 2 follow-up).
 *
 * Settlement posts a downward correction as a `reconciliation_reversal`
 * cost_entry with a POSITIVE amount (the journal moves the money the other
 * way). Every "net actual spend" read must SUBTRACT those rows, or a file whose
 * actual was corrected from 100k to 80k reports 120k. `netAmountSql` is the one
 * definition; these tests pin it and pin that two representative consumers use
 * the signed form.
 */

const { netAmountSql, REVERSAL_CATEGORY } = require("../../src/shared/finance/cost-entry-sql");

const SIGNED = (p) =>
  new RegExp(`WHEN ${p}category = '${REVERSAL_CATEGORY}' THEN -${p}amount ELSE ${p}amount END`);

function sqlCapturingClient(rows = []) {
  const seen = [];
  return { seen, async query(sql) { seen.push(sql); return { rows }; } };
}

describe("netAmountSql", () => {
  test("aliased form subtracts the reversal category", () => {
    expect(netAmountSql("ce")).toMatch(SIGNED("ce\\."));
    expect(netAmountSql("ce")).toMatch(/^SUM\(/);
  });
  test("bare form (no alias) subtracts the reversal category", () => {
    expect(netAmountSql()).toMatch(SIGNED(""));
    expect(netAmountSql("")).toMatch(SIGNED(""));
  });
  test("REVERSAL_CATEGORY is the string settle() stamps", () => {
    expect(REVERSAL_CATEGORY).toBe("reconciliation_reversal");
  });
});

describe("consumers read cost_entry NET of reversals", () => {
  test("cost_tracking.actualTotal subtracts reversals", async () => {
    const repo = require("../../src/modules/costing/cost_tracking/cost_tracking.repo");
    const c = sqlCapturingClient([{ total: 0 }]);
    await repo.actualTotal(c, "00000000-0000-4000-8000-000000000001");
    expect(c.seen.join("\n")).toMatch(SIGNED(""));
  });

  test("report.dossierMarginPortfolio subtracts reversals", async () => {
    const repo = require("../../src/modules/vault/report/report.repo");
    const c = sqlCapturingClient([]);
    await repo.dossierMarginPortfolio(c, {});
    expect(c.seen.join("\n")).toMatch(SIGNED(""));
  });
});
