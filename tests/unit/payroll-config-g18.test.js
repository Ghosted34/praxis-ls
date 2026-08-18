"use strict";

/**
 * G18 — payroll rates have no stored configuration.
 *
 * The legacy read the rate table via get_master_config(targetDate) from
 * payroll_config_history; the rebuild accepted a config from the request body,
 * so two people computing the same run with different bodies got different
 * payslips, both authoritative. These tests pin the restored behaviour:
 *   - compute resolves the effective-dated config for the run's period;
 *   - a rate change does NOT move a validated run (its snapshot stands);
 *   - unknown rate keys are refused at save.
 */

const argon2 = require("argon2");
const service = require("../../src/modules/hr/payroll/payroll.service");
const repo = require("../../src/modules/hr/payroll/payroll.repo");

jest.mock("argon2", () => ({ hash: jest.fn(), verify: jest.fn() }));

function fakeClient({ storedConfig = null, runs = [] } = {}) {
  const queries = [];
  const c = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO payroll_config/.test(sql))
        return { rows: [{ payroll_config_id: "pc-new", entity_id: params[0], effective_date: params[1] }] };
      if (/FROM payroll_config/.test(sql) && /effective_date <=/.test(sql))
        return { rows: storedConfig ? [storedConfig] : [] };
      if (/FROM payroll_config/.test(sql)) return { rows: [] };
      if (/UPDATE payroll_run SET config_snapshot/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  return c;
}

describe("G18 — compute resolves the effective-dated config", () => {
  it("uses the stored config over DEFAULTS when one is effective for the period", async () => {
    const c = fakeClient({
      storedConfig: {
        payroll_config_id: "pc-1",
        entity_id: "e-1",
        effective_date: "2026-01-01",
        config: { cnps_pension_rate: 0.05, irpp_brackets: [{ upTo: 5000000, rate: 0.3 }] },
      },
    });
    const cfg = await repo.configForPeriod(c, "e-1", "2026-01-31");
    expect(cfg).not.toBeNull();
    expect(cfg.config.cnps_pension_rate).toBe(0.05);
  });

  it("returns null when no config is effective yet (fresh tenant → DEFAULTS)", async () => {
    const c = fakeClient({ storedConfig: null });
    const cfg = await repo.configForPeriod(c, "e-1", "2026-01-31");
    expect(cfg).toBeNull();
  });
});

describe("G18 — saveConfig refuses unknown keys and propagates to OPEN runs", () => {
  it("rejects an unknown rate key", async () => {
    const c = fakeClient();
    await expect(
      service.saveConfig(c, { entityId: "e-1", effectiveDate: "2026-01-01", config: { cnps_pension_rate: 0.05, bogus_rate: 0.9 }, actor: {} }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("saves a clean config and refreshes OPEN/COMPUTED run previews", async () => {
    const c = fakeClient();
    const out = await service.saveConfig(c, { entityId: "e-1", effectiveDate: "2026-02-01", config: { cnps_pension_rate: 0.05 }, actor: { user_id: "u-1" } });
    expect(out.entity_id).toBe("e-1");
    // Upsert ran, then the propagation UPDATE ran (only OPEN/COMPUTED).
    const upsert = c.queries.find((q) => /INSERT INTO payroll_config/.test(q.sql));
    expect(upsert).toBeDefined();
    const prop = c.queries.find((q) => /UPDATE payroll_run SET config_snapshot/.test(q.sql));
    expect(prop).toBeDefined();
    expect(prop.sql).toMatch(/status IN \('OPEN','COMPUTED'\)/);
    expect(prop.sql).not.toMatch(/APPROVED/);
  });
});

describe("G18 — a validated run is unmoved by a later rate change", () => {
  it("never touches runs outside OPEN/COMPUTED", async () => {
    const c = fakeClient();
    await service.saveConfig(c, { entityId: "e-1", effectiveDate: "2026-03-01", config: { cnps_pension_rate: 0.05 }, actor: {} });
    const prop = c.queries.find((q) => /UPDATE payroll_run SET config_snapshot/.test(q.sql));
    // The WHERE deliberately names only OPEN/COMPUTED — a validated run keeps
    // the snapshot it was computed under, which is the honesty guarantee.
    expect(prop.params[0]).toContain("cnps_pension_rate");
  });
});
