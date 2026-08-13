"use strict";

// Mock the delegated producers so the portal views can be exercised without a DB.
jest.mock("../../src/modules/vault/report/report.service", () => ({
  run: jest.fn(async (_c, { reportKey }) => {
    const data =
      {
        income_statement: { produits: 1000, charges: 600, result: 400 },
        balance_sheet: { active: 5000 },
        cash_position: { total_cash: 250 },
        cash_flow: { net: 100 },
        trial_balance: { rows: [], totals: { debit: 5, credit: 5 } },
        procurement_spend: { total: 300 },
      }[reportKey] || {};
    return { report_key: reportKey, data };
  }),
}));
jest.mock("../../src/modules/portal/portal.repo", () => ({
  auditLedger: jest.fn(async () => [
    { ledger_id: 1, action: "invoice.posted", actor_name: "Jane" },
  ]),
}));

const report = require("../../src/modules/vault/report/report.service");
const repo = require("../../src/modules/portal/portal.repo");
const portal = require("../../src/modules/portal/portal.service");
const { isGrantUsable } = require("../../src/modules/portal/portal.rules");

describe("Portal access grant usability", () => {
  const now = Date.parse("2026-07-11");
  test("active + no expiry → usable", () => {
    expect(isGrantUsable({ is_active: true, expires_at: null }, now)).toBe(
      true,
    );
  });
  test("active + future expiry → usable; past expiry → not", () => {
    expect(
      isGrantUsable({ is_active: true, expires_at: "2026-12-31" }, now),
    ).toBe(true);
    expect(
      isGrantUsable({ is_active: true, expires_at: "2026-01-01" }, now),
    ).toBe(false);
  });
  test("inactive or missing → not usable", () => {
    expect(isGrantUsable({ is_active: false, expires_at: null }, now)).toBe(
      false,
    );
    expect(isGrantUsable(null, now)).toBe(false);
  });
});

describe("investorView KPIs (OHADA basis — PRD Q4 resolved)", () => {
  test("derives net margin + expense ratio from the statements", async () => {
    const out = await portal.investorView(
      {},
      { params: { from: "2026-01-01", to: "2026-06-30" } },
    );
    expect(out.basis).toBe("OHADA");
    expect(out.kpis.net_margin_pct).toBe(40); // 400/1000
    expect(out.kpis.expense_ratio_pct).toBe(60); // 600/1000
    expect(out.kpis.revenue).toBe(1000);
  });

  test("margins are null (not 0 or Infinity) when revenue is zero", async () => {
    const orig = report.run.getMockImplementation();
    report.run.mockImplementation(async (c, args) =>
      args.reportKey === "income_statement"
        ? { data: { produits: 0, charges: 0, result: 0 } }
        : orig(c, args),
    );
    const out = await portal.investorView({}, { params: {} });
    expect(out.kpis.net_margin_pct).toBeNull();
    expect(out.kpis.expense_ratio_pct).toBeNull();
    report.run.mockImplementation(orig);
  });
});

describe("auditorView (curated, period-scoped)", () => {
  beforeEach(() => repo.auditLedger.mockClear());

  test("composes statements + procurement + a named audit trail, OHADA basis", async () => {
    const out = await portal.auditorView(
      {},
      { params: { from: "2026-01-01", to: "2026-12-31", entity_id: "e1" } },
    );
    expect(out.portal).toBe("AUDITOR");
    expect(out.basis).toBe("OHADA");
    expect(out.scope.entity_id).toBe("e1");
    expect(out.income_statement).toBeDefined();
    expect(out.trial_balance).toBeDefined();
    expect(out.procurement_spend).toBeDefined();
    expect(out.audit_trail).toEqual([
      { ledger_id: 1, action: "invoice.posted", actor_name: "Jane" },
    ]);
    expect(out.disclosure).toMatch(/excluded/i);
  });

  test("queries the ledger with a finance/document allow-list, never HR/security", async () => {
    await portal.auditorView(
      {},
      { params: { from: "2026-01-01", to: "2026-12-31" } },
    );
    const arg = repo.auditLedger.mock.calls[0][1];
    expect(arg.from).toBe("2026-01-01");
    expect(arg.to).toBe("2026-12-31");
    expect(arg.prefixes).toEqual(
      expect.arrayContaining(["invoice", "journal", "document", "costing"]),
    );
    for (const banned of [
      "permission",
      "role",
      "godmode",
      "payroll",
      "employee",
      "user",
      "session",
    ]) {
      expect(arg.prefixes).not.toContain(banned);
    }
  });
});
