/**
 * Connection budget — INCIDENT 2026-08-12.
 *
 * The outage had no bug in it. Every setting involved was individually
 * defensible; the fault was that their SUM had never been compared with what
 * Postgres would accept. `DB_POOL_MAX` 10 plus `TENANT_POOL_MAX` 8 ×
 * `TENANT_POOL_CACHE_MAX` 24, across three processes, is 606 connections against
 * a `max_connections` that docker-compose never set — so 100.
 *
 * These tests exist to make that arithmetic a thing the build checks rather than
 * a thing someone notices. The first case is the incident's own numbers: if it
 * ever returns `ok: true`, the check has stopped protecting anything.
 *
 * `config` is frozen at load, so the settings are injected through a mock rather
 * than assigned — the real object refuses writes, which is correct of it.
 */
"use strict";

jest.mock("../../src/config/env", () => ({ config: {} }));
jest.mock("../../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

const budget = require("../../src/config/connection-budget");
const { config } = require("../../src/config/env");

/** A platform-DB stand-in that reports whatever max_connections we ask about. */
const dbReporting = (max) => ({
  query: async () => ({ rows: [{ max_connections: String(max) }] }),
});

/** The settings as they stood on the day, before any of the remediation. */
const AS_OF_INCIDENT = {
  DB_BUDGET_CHECK: "warn",
  DB_POOL_MAX: 10,
  OPS_POOL_MAX: 0, // the ops pool did not exist yet — it is part of the fix
  TENANT_POOL_MAX: 8,
  TENANT_POOL_CACHE_MAX: 24,
  DB_BUDGET_PROCESSES: 3,
  DB_BUDGET_HEADROOM_PCT: 20,
  TENANT_DB_POOLER_HOST: "",
};

/** Replace the injected config wholesale for one test. */
function given(over) {
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, over);
}

beforeEach(() => given(AS_OF_INCIDENT));

describe("connection budget", () => {
  test("the 2026-08-12 configuration is rejected", async () => {
    const r = await budget.evaluate(dbReporting(100));
    expect(r.ok).toBe(false);
    // 10 + (8 × 24) = 202 per process, × 3 = 606.
    expect(r.ceiling).toBe(606);
    expect(r.allowed).toBe(80); // 100 less 20% headroom
  });

  test("the corrected configuration fits", async () => {
    given({
      ...AS_OF_INCIDENT,
      OPS_POOL_MAX: 4,
      TENANT_POOL_MAX: 4,
      TENANT_POOL_CACHE_MAX: 12,
    });
    const r = await budget.evaluate(dbReporting(300));
    expect(r.ok).toBe(true);
    expect(r.ceiling).toBe(186); // (10 + 4 + 48) × 3
    expect(r.allowed).toBe(240);
  });

  test("the ops pool counts toward the budget", async () => {
    // It exists to stop background work starving requests, but it is still real
    // connections against the same server. A budget that omits the pool added to
    // fix the last incident is how the next one starts.
    given({
      ...AS_OF_INCIDENT,
      TENANT_POOL_MAX: 0,
      TENANT_POOL_CACHE_MAX: 0,
      OPS_POOL_MAX: 7,
    });
    const r = await budget.evaluate(dbReporting(300));
    expect(r.per.ops).toBe(7);
    expect(r.ceiling).toBe(51); // (10 + 7) × 3
  });

  test("headroom is reserved, not merely nominal — a budget that exactly fills max_connections fails", async () => {
    // Migrations, pg_dump, the restore drill and a human with psql all need
    // connections that no pool setting accounts for. "It fits exactly" is the
    // configuration where the nightly backup is what takes the site down.
    given({
      ...AS_OF_INCIDENT,
      DB_POOL_MAX: 100,
      OPS_POOL_MAX: 0,
      TENANT_POOL_MAX: 0,
      TENANT_POOL_CACHE_MAX: 0,
      DB_BUDGET_PROCESSES: 1,
    });
    const r = await budget.evaluate(dbReporting(100));
    expect(r.ok).toBe(false);
  });

  test("a pooler in front reports rather than judges", async () => {
    // Oversubscribing max_connections is the entire purpose of a transaction
    // pooler, so the server limit stops being the binding constraint and
    // PGBOUNCER_MAX_DB_CONNECTIONS starts. Failing here would block the fix.
    given({
      ...AS_OF_INCIDENT,
      DB_BUDGET_CHECK: "enforce",
      TENANT_DB_POOLER_HOST: "pgbouncer",
    });
    const r = await budget.evaluate(dbReporting(100));
    expect(r.ok).toBe(true);
    expect(r.pooled).toBe(true);
  });

  test("an unreadable max_connections does not block a boot", async () => {
    // The check is a guard rail, not a dependency. A Postgres that will not
    // answer SHOW is a problem the readiness gate should report, not one this
    // should turn into a refusal to start.
    given({ ...AS_OF_INCIDENT, DB_BUDGET_CHECK: "enforce" });
    const r = await budget.evaluate({
      query: async () => {
        throw new Error("nope");
      },
    });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeTruthy();
  });

  test("enforce throws, warn does not", async () => {
    given({ ...AS_OF_INCIDENT, DB_BUDGET_CHECK: "warn" });
    await expect(budget.check(dbReporting(100))).resolves.toMatchObject({
      ok: false,
    });

    given({ ...AS_OF_INCIDENT, DB_BUDGET_CHECK: "enforce" });
    await expect(budget.check(dbReporting(100))).rejects.toMatchObject({
      code: "DB_BUDGET_EXCEEDED",
    });
  });

  test("off skips entirely", async () => {
    given({ ...AS_OF_INCIDENT, DB_BUDGET_CHECK: "off" });
    const r = await budget.evaluate(dbReporting(1));
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe("DB_BUDGET_CHECK=off");
  });
});
