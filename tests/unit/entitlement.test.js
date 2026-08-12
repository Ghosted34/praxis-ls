"use strict";

/**
 * WS-S3 — entitlement, metering and enforcement.
 *
 * This is the bridge from feature gating to billing, so the tests concentrate on
 * the decisions that would be expensive to get wrong in a commercial system:
 *
 *   - UNLIMITED vs ZERO. A metric with no entitlement is uncapped. Treating the
 *     absence of a row as a limit of nothing would lock every tenant out of
 *     everything the moment this shipped.
 *   - SOFT vs HARD. A soft limit reports and allows; a hard one throws a typed
 *     402. If those blur, either nobody is ever blocked or everybody is.
 *   - "WOULD THIS ACTION EXCEED", not "are they already over". Checking after
 *     the fact permits exactly one breach every single time.
 *   - LEVEL vs FLOW metering. Summing a level metric multiplies a tenant's seat
 *     count by how often it was measured; replacing a flow metric discards
 *     everything before the last sweep.
 */

jest.mock("../../src/services/platform/db", () => ({ query: jest.fn(), close: jest.fn() }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(),
  listActiveTenants: jest.fn(),
}));

const platformDb = require("../../src/services/platform/db");
const registry = require("../../src/services/tenant/registry.service");
const entitlement = require("../../src/services/platform/entitlement.service");

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Make statusFor() return one metric row. */
function givenStatus(rows) {
  platformDb.query.mockResolvedValue({ rows });
}

beforeEach(() => jest.clearAllMocks());

describe("statusFor — unlimited is not zero", () => {
  test("a metric with no entitlement reports limit null and no percentage", async () => {
    givenStatus([{ metric: "seats", used: 12, limit_value: null, hard: null, measured_at: null }]);
    const [row] = await entitlement.statusFor(TENANT);
    expect(row.limit).toBeNull();
    expect(row.pct).toBeNull();
    expect(row.over).toBe(false);
  });

  test("a metric under its limit is not over and not warning", async () => {
    givenStatus([{ metric: "seats", used: 5, limit_value: 20, hard: true, measured_at: null }]);
    const [row] = await entitlement.statusFor(TENANT);
    expect(row.pct).toBe(25);
    expect(row.over).toBe(false);
    expect(row.warning).toBe(false);
  });

  test("80% of a limit is where warning starts — below that it is noise", async () => {
    givenStatus([{ metric: "seats", used: 16, limit_value: 20, hard: false, measured_at: null }]);
    const [row] = await entitlement.statusFor(TENANT);
    expect(row.warning).toBe(true);
    expect(row.over).toBe(false);
  });

  test("past the limit is over, and no longer merely a warning", async () => {
    givenStatus([{ metric: "seats", used: 21, limit_value: 20, hard: false, measured_at: null }]);
    const [row] = await entitlement.statusFor(TENANT);
    expect(row.over).toBe(true);
    expect(row.warning).toBe(false);
  });
});

describe("check — the enforcement gate", () => {
  test("no entitlement configured allows anything", async () => {
    givenStatus([]);
    const r = await entitlement.check(TENANT, "seats", { additional: 1 });
    expect(r.allowed).toBe(true);
    expect(r.limit).toBeNull();
  });

  test("a HARD limit throws a typed 402 when the action would exceed it", async () => {
    givenStatus([{ metric: "seats", used: 20, limit_value: 20, hard: true, measured_at: null }]);
    await expect(entitlement.check(TENANT, "seats", { additional: 1 })).rejects.toMatchObject({
      code: "ENTITLEMENT_EXCEEDED",
      // 402 Payment Required: a commercial limit, not a permission problem (403)
      // and not a malformed request (422).
      status: 402,
    });
  });

  test("the error carries what was used, the limit, and what was asked for", async () => {
    givenStatus([{ metric: "seats", used: 20, limit_value: 20, hard: true, measured_at: null }]);
    const err = await entitlement.check(TENANT, "seats", { additional: 3 }).catch((e) => e);
    expect(err.details).toEqual({ metric: "seats", used: 20, limit: 20, requested: 3 });
  });

  test("it asks 'would this exceed', not 'are they already over'", async () => {
    // Exactly at the limit with nothing being added: allowed. Checking after the
    // fact would have permitted one more.
    givenStatus([{ metric: "seats", used: 20, limit_value: 20, hard: true, measured_at: null }]);
    await expect(entitlement.check(TENANT, "seats", { additional: 0 })).resolves.toMatchObject({ allowed: true });
  });

  test("a SOFT limit never throws — it reports and allows", async () => {
    givenStatus([{ metric: "seats", used: 25, limit_value: 20, hard: false, measured_at: null }]);
    const r = await entitlement.check(TENANT, "seats", { additional: 1 });
    expect(r.allowed).toBe(true);
    expect(r.exceeded_soft).toBe(true);
  });

  test("a live count overrides the cached figure", async () => {
    // The seat path passes a fresh count because its tenant connection is
    // already open. Cached usage says they are full; reality says they are not.
    givenStatus([{ metric: "seats", used: 20, limit_value: 20, hard: true, measured_at: null }]);
    const r = await entitlement.check(TENANT, "seats", { additional: 1, liveUsed: 3 });
    expect(r.allowed).toBe(true);
    expect(r.used).toBe(3);
  });

  test("a live count can also BLOCK when the cache is stale in the other direction", async () => {
    givenStatus([{ metric: "seats", used: 1, limit_value: 20, hard: true, measured_at: null }]);
    await expect(
      entitlement.check(TENANT, "seats", { additional: 1, liveUsed: 20 }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_EXCEEDED" });
  });
});

describe("setEntitlement", () => {
  test("an unknown metric is refused rather than stored", async () => {
    // A limit against a metric no meter reports would silently never fire —
    // worse than an error, because it looks configured.
    await expect(
      entitlement.setEntitlement({ planId: "p1", metric: "made_up", limitValue: 5 }),
    ).rejects.toMatchObject({ code: "UNKNOWN_METRIC", status: 422 });
    expect(platformDb.query).not.toHaveBeenCalled();
  });

  test("a known metric is upserted", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ metric: "seats", limit_value: 10 }] });
    await entitlement.setEntitlement({ planId: "p1", metric: "seats", limitValue: 10, hard: true });
    expect(platformDb.query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (plan_id, metric)"),
      ["p1", "seats", 10, true],
    );
  });
});

describe("record — level replaces, flow accumulates", () => {
  test("a LEVEL metric replaces the period value", async () => {
    platformDb.query.mockResolvedValue({ rows: [{}] });
    await entitlement.record(TENANT, "seats", 12);
    // Summing a level metric across a month multiplies the seat count by how
    // many times it was measured.
    expect(platformDb.query.mock.calls[0][0]).toContain("used = EXCLUDED.used");
    expect(platformDb.query.mock.calls[0][0]).not.toContain("tenant_usage.used +");
  });

  test("a FLOW metric adds to the period value", async () => {
    platformDb.query.mockResolvedValue({ rows: [{}] });
    await entitlement.record(TENANT, "emails_month", 5);
    expect(platformDb.query.mock.calls[0][0]).toContain("platform.tenant_usage.used + EXCLUDED.used");
  });

  test("an unknown metric is rejected", async () => {
    await expect(entitlement.record(TENANT, "nope", 1)).rejects.toThrow(/unknown metric/i);
  });
});

describe("metering", () => {
  test("re-running the sweep does not double a tenant's figures", async () => {
    // Every meter RE-READS its source and writes a replacement, so a retried
    // job, an operator pressing the button and a scheduler firing twice after a
    // restart all produce the same number. A metering system that inflates
    // under any of those is one nobody will invoice from.
    registry.withTenantConnection.mockImplementation(async (_meta, _schema, fn) =>
      fn({ query: async () => ({ rows: [{ n: 7, c: "1500", b: "0" }] }) }),
    );
    platformDb.query.mockResolvedValue({ rows: [{}] });

    await entitlement.measureTenant({ tenant_id: TENANT, slug: "acme" });

    for (const call of platformDb.query.mock.calls) {
      expect(call[0]).toContain("used = EXCLUDED.used");
      expect(call[0]).not.toContain("tenant_usage.used +");
    }
  });

  test("one tenant's meter failing does not stop the sweep", async () => {
    registry.listActiveTenants.mockResolvedValue([
      { tenant_id: "t1", slug: "one" },
      { tenant_id: "t2", slug: "two" },
    ]);
    registry.withTenantConnection.mockRejectedValue(new Error("db down"));
    platformDb.query.mockResolvedValue({ rows: [{}] });

    const r = await entitlement.measureFleet();
    // Each tenant's individual meters log and continue, so the tenant itself
    // still counts as processed — the sweep must never abort partway and leave
    // half the fleet unmeasured.
    expect(r.total).toBe(2);
    expect(r.ok).toBe(2);
  });

  test("seats counts only ACTIVE users", async () => {
    let seenSql = "";
    registry.withTenantConnection.mockImplementation(async (_meta, _schema, fn) =>
      fn({
        query: async (sql) => {
          if (sql.includes("app_user")) seenSql = sql;
          return { rows: [{ n: 4, c: "0" }] };
        },
      }),
    );
    platformDb.query.mockResolvedValue({ rows: [{}] });

    await entitlement.measureTenant({ tenant_id: TENANT, slug: "acme" });
    // Billing a tenant for people they suspended is the complaint that makes a
    // metering system distrusted on day one.
    expect(seenSql).toContain("status = 'ACTIVE'");
  });
});

describe("the metric catalogue", () => {
  test("storage is declared but honestly marked as not yet metered", async () => {
    // document_vault records no byte size, so there is nothing to sum. Declaring
    // it lets a limit be set and shown; pretending to measure it would produce a
    // number someone eventually bills on.
    expect(entitlement.METRICS.storage_gb.metered).toBe(false);
    expect(entitlement.METRICS.seats.metered).toBe(true);
    expect(entitlement.METRICS.ai_spend_xaf.metered).toBe(true);
  });

  test("currentPeriod is always the first of a month", () => {
    expect(entitlement.currentPeriod(new Date("2026-08-17T13:00:00Z"))).toBe("2026-08-01");
  });
});
