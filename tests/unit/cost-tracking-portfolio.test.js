"use strict";

/**
 * Cost tracking: the portfolio sheet and the advance join.
 *
 * These are the two findings of doc/COST_TRACKING_LEGACY_COMPARISON.md, built.
 *
 *   §4  Advances were never joined to the cost-tracking read, so `total_advance`,
 *       `total_balance` and `coverage_percentage` — three columns of the legacy
 *       master view — had no equivalent. The data existed all along in `advance`
 *       (0230:38), at a BETTER grain than legacy's per-cost-line column; the gap
 *       was the read.
 *
 *   §C  Both routes were `/dossier/:dossierId/…`, so "which files are over
 *       budget" needed one round-trip per dossier.
 *
 * The thing these tests most exist to protect is that the per-row arithmetic is
 * the SAME `reconcile`/`coverage` used by the single-dossier read, not a second
 * copy in SQL. The legacy computed its status in a view AND again in PHP and the
 * two disagreed (§5); one definition applied twice is the whole point.
 */

const fs = require("fs");
const path = require("path");

jest.mock(
  "../../src/modules/finance/journal_entry/journal_entry.service",
  () => ({
    buildAndInsert: jest.fn(),
  }),
);
jest.mock("../../src/services/compliance/proof-obligation.service", () => ({
  check: jest.fn(),
  RULE_KEYS: {},
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));
jest.mock("../../src/shared/config/finance-accounts", () => ({
  accountFor: jest.fn(),
}));

const service = require("../../src/modules/costing/cost_tracking/cost_tracking.service");

/** A client answering the four reads the portfolio path makes. */
function stubClient({
  rows = [],
  budget = 0,
  actual = 0,
  advance = null,
} = {}) {
  return {
    queries: [],
    async query(text, params) {
      this.queries.push({ text, params });
      if (/FROM dossier_visible d/i.test(text)) return { rows };
      if (/FROM costing_line cl JOIN costing/i.test(text))
        return { rows: [{ total: budget }] };
      if (/FROM cost_entry WHERE dossier_id/i.test(text))
        return { rows: [{ total: actual }] };
      if (/FROM advance WHERE dossier_id/i.test(text)) {
        return { rows: [advance || { received: 0, applied: 0 }] };
      }
      return { rows: [] };
    },
  };
}

describe("reconcileDossier now answers the coverage question", () => {
  test("advances are joined in, with balance and coverage derived", async () => {
    const c = stubClient({
      budget: 1000,
      actual: 1200,
      advance: { received: 600, applied: 500 },
    });
    const out = await service.reconcileDossier(c, { dossierId: "d1" });

    // The reconciliation half is unchanged.
    expect(out.budget).toBe(1000);
    expect(out.actual).toBe(1200);
    expect(out.variance).toBe(200);
    expect(out.over_budget).toBe(true);

    // The half that was missing.
    expect(out.advance_received).toBe(600);
    expect(out.advance_applied).toBe(500);
    expect(out.balance).toBe(600); // 1200 spent − 600 advanced
    expect(out.coverage_percent).toBe(50);
  });

  test("coverage is null, not 0, when nothing has been spent", async () => {
    // 0% reads as "nothing is covered"; the truth is "there is nothing to
    // cover yet". Same rule reconcile() already applies to variance_percent.
    const c = stubClient({
      budget: 500,
      actual: 0,
      advance: { received: 0, applied: 0 },
    });
    const out = await service.reconcileDossier(c, { dossierId: "d1" });
    expect(out.coverage_percent).toBeNull();
    // variance_percent divides by the BUDGET, which is non-zero here, so it is
    // a real -100% (nothing of a 500 budget spent) — a different question.
    expect(out.variance_percent).toBe(-100);
  });

  test("an over-funded file reports more than 100%, not a clamp", async () => {
    const c = stubClient({
      budget: 0,
      actual: 100,
      advance: { received: 250, applied: 0 },
    });
    const out = await service.reconcileDossier(c, { dossierId: "d1" });
    expect(out.coverage_percent).toBe(250);
    expect(out.balance).toBe(-150); // negative = the client is in credit
  });
});

describe("the portfolio sheet", () => {
  const ROWS = [
    {
      dossier_id: "d1",
      ref: "SLAS-2026-0001",
      budget: 1000,
      actual: 1200,
      advance_received: 600,
      advance_applied: 0,
    },
    {
      dossier_id: "d2",
      ref: "SLAS-2026-0002",
      budget: 2000,
      actual: 1500,
      advance_received: 1500,
      advance_applied: 0,
    },
    {
      dossier_id: "d3",
      ref: "SLAS-2026-0003",
      budget: 0,
      actual: 0,
      advance_received: 0,
      advance_applied: 0,
    },
  ];

  test("every row carries the same derived fields as the single read", async () => {
    const rows = await service.portfolio(stubClient({ rows: ROWS }));
    expect(rows).toHaveLength(3);

    const [over, under, empty] = rows;
    expect(over.variance).toBe(200);
    expect(over.over_budget).toBe(true);
    expect(over.coverage_percent).toBe(50);

    expect(under.variance).toBe(-500);
    expect(under.over_budget).toBe(false);
    expect(under.coverage_percent).toBe(100);

    expect(empty.coverage_percent).toBeNull();
  });

  test("the query does not fan out across the three aggregates", async () => {
    // Three LEFT JOINs to costing_line, cost_entry and advance would multiply
    // rows and silently inflate every SUM. LATERAL scalar subqueries keep each
    // aggregate independently correct.
    const c = stubClient({ rows: ROWS });
    await service.portfolio(c);
    const q = c.queries.find((x) =>
      /FROM dossier_visible d/i.test(x.text),
    ).text;
    expect(q).toMatch(/LEFT JOIN LATERAL/);
    expect(q.match(/LEFT JOIN LATERAL/g)).toHaveLength(3);
    expect(q).not.toMatch(/GROUP BY/i);
  });

  test("it enumerates from dossier_visible, so DRAFTs never appear", async () => {
    // A DRAFT dossier is half-finished wizard state, not a file (0671). The
    // first draft of this query read the base table and
    // tests/unit/dossier-draft-isolation caught it.
    const c = stubClient({ rows: ROWS });
    await service.portfolio(c);
    const q = c.queries.find((x) =>
      /FROM dossier_visible d/i.test(x.text),
    ).text;
    expect(q).toMatch(/FROM dossier_visible/);
    expect(q).not.toMatch(/FROM dossier\s+d/);
  });

  test("budget counts APPROVED_LOCKED costings only", async () => {
    // A draft is not an authorised budget to be measured against — the same
    // rule approvedBudgetTotal already applies.
    const c = stubClient({ rows: ROWS });
    await service.portfolio(c);
    const q = c.queries.find((x) =>
      /FROM dossier_visible d/i.test(x.text),
    ).text;
    expect(q).toMatch(/cg\.status = 'APPROVED_LOCKED'/);
  });

  test("dossiers with neither a budget nor an actual are excluded", async () => {
    const c = stubClient({ rows: ROWS });
    await service.portfolio(c);
    const q = c.queries.find((x) =>
      /FROM dossier_visible d/i.test(x.text),
    ).text;
    expect(q).toMatch(/b\.total IS NOT NULL OR a\.total IS NOT NULL/);
  });
});

describe("the portfolio KPIs", () => {
  const ROWS = [
    {
      dossier_id: "d1",
      budget: 1000,
      actual: 1200,
      advance_received: 600,
      advance_applied: 0,
    },
    {
      dossier_id: "d2",
      budget: 2000,
      actual: 1500,
      advance_received: 900,
      advance_applied: 0,
    },
  ];

  test("totals and the over-budget count agree with the rows", async () => {
    const k = await service.portfolioKpis(stubClient({ rows: ROWS }));
    expect(k.files_tracked).toBe(2);
    expect(k.over_budget).toBe(1); // only d1
    expect(k.total_budget).toBe(3000);
    expect(k.total_actual).toBe(2700);
    expect(k.total_variance).toBe(-300);
    expect(k.total_advance_received).toBe(1500);
    expect(k.total_balance).toBe(1200); // 2700 − 1500
    expect(k.overall_coverage_percent).toBeCloseTo(55.56, 1);
  });

  test("an empty portfolio reports zeros and a null coverage", async () => {
    const k = await service.portfolioKpis(stubClient({ rows: [] }));
    expect(k.files_tracked).toBe(0);
    expect(k.total_actual).toBe(0);
    // Not 0% — there is nothing to cover.
    expect(k.overall_coverage_percent).toBeNull();
  });
});

describe("wiring", () => {
  const root = path.join(__dirname, "..", "..");
  const routes = fs.readFileSync(
    path.join(
      root,
      "src/modules/costing/cost_tracking/cost_tracking.routes.js",
    ),
    "utf8",
  );
  const pages = fs.readFileSync(
    path.join(root, "client/src/features/costing/pages.tsx"),
    "utf8",
  );

  test("the literal routes are registered before the parameterised one", () => {
    const registered = routes
      .split("\n")
      .filter((l) => /^router\.get\(/.test(l))
      .map((l) => l.match(/"([^"]+)"/)[1]);
    expect(registered).toContain("/portfolio");
    expect(registered.indexOf("/portfolio")).toBeLessThan(
      registered.indexOf("/dossier/:dossierId"),
    );
    expect(registered.indexOf("/kpis")).toBeLessThan(
      registered.indexOf("/dossier/:dossierId"),
    );
  });

  test("both reads are permission-gated like the rest of MOD-47", () => {
    for (const line of routes
      .split("\n")
      .filter((l) => /\/portfolio|\/kpis/.test(l))) {
      expect(line).toContain('requirePermission(MODULE, "view")');
    }
  });

  test("the client reads `budget`, not the keys that never existed", () => {
    // The Planned tile read rc.planned_cost ?? rc.planned; reconcile() returns
    // { budget, actual, variance, variance_percent, over_budget }, so it
    // rendered empty for every dossier ever selected.
    const code = pages
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("planned_cost");
    expect(code).not.toContain("rc.planned");
    expect(code).toContain("money(rc.budget)");
  });
});
