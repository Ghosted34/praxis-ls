"use strict";

/**
 * The certified-signature quota watch — doc/SIGNATURE_ENGINEERING_GUIDE.md
 * §7.5.
 *
 * The behaviour worth pinning is the ALERTING, not the counting: two
 * thresholds (80/95), each firing ONCE per calendar month, and a new month
 * that resets the dedupe. A quota alert that repeats daily is the one that
 * gets muted; a muted quota alert is the one that is silent the week the
 * month actually runs out.
 */

const registry = require("../../src/services/tenant/registry.service");
const platformSettings = require("../../src/services/platform/settings.service");
const alertRouting = require("../../src/services/platform/alert-routing.service");
const qesIndex = require("../../src/services/qes");
const handler = require("../../src/jobs/handlers/qes-quota");

const tenants = [
  { db_name: "tenant_a", slug: "a", name: "Tenant A" },
  { db_name: "tenant_b", slug: "b", name: "Tenant B" },
];

/** Per-tenant counts keyed by slug; the fake connection answers the count query. */
const makeRegistry = (counts) => {
  jest.spyOn(registry, "listActiveTenants").mockResolvedValue(tenants);
  jest.spyOn(registry, "withTenantConnection").mockImplementation(async (meta, _env, fn) => {
    const client = {
      query: async () => ({ rows: [{ n: counts[meta.slug] || 0 }] }),
    };
    return fn(client);
  });
};

/** The handler's month, computed the same way it is (UTC calendar month). */
const currentMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the counting", () => {
  test("the fleet total is the sum of each tenant's ledger rows this month", async () => {
    makeRegistry({ a: 17, b: 5 });
    jest.spyOn(qesIndex, "platformPricing").mockResolvedValue({ unitCost: 0, currency: "XAF", monthlyQuota: 100 });
    jest.spyOn(platformSettings, "resolve").mockResolvedValue(null);
    const raise = jest.spyOn(alertRouting, "raise").mockResolvedValue({ delivered: true });

    const out = await handler();

    expect(out).toMatchObject({ total: 22, quota: 100, pct: 22, counted: 2, failed: 0 });
    expect(raise).not.toHaveBeenCalled();
  });

  test("a wedged tenant database is counted as a failure, not a zero", async () => {
    // tenant_b's database is down. The total must be what we COULD count,
    // and the failed count must make the number honest.
    jest.spyOn(registry, "listActiveTenants").mockResolvedValue(tenants);
    jest.spyOn(registry, "withTenantConnection").mockImplementation(async (meta, _env, fn) => {
      if (meta.slug === "b") throw new Error("connection refused");
      const client = { query: async () => ({ rows: [{ n: 17 }] }) };
      return fn(client);
    });
    jest.spyOn(qesIndex, "platformPricing").mockResolvedValue({ unitCost: 0, currency: "XAF", monthlyQuota: 100 });
    jest.spyOn(platformSettings, "resolve").mockResolvedValue(null);
    jest.spyOn(alertRouting, "raise").mockResolvedValue({ delivered: true });

    const out = await handler();

    expect(out).toMatchObject({ total: 17, counted: 1, failed: 1 });
  });

  test("no quota configured: nothing to watch, nothing to say", async () => {
    makeRegistry({ a: 100 });
    jest.spyOn(qesIndex, "platformPricing").mockResolvedValue({ unitCost: 0, currency: "XAF", monthlyQuota: 0 });

    const out = await handler();
    expect(out).toEqual({ skipped: "no quota configured" });
  });
});

describe("the alerting — once per threshold, once per month", () => {
  const at = (total, quota = 100) => {
    makeRegistry({ a: total, b: 0 });
    jest.spyOn(qesIndex, "platformPricing").mockResolvedValue({ unitCost: 0, currency: "XAF", monthlyQuota: quota });
  };

  test("below 80%: no alert", async () => {
    at(79);
    jest.spyOn(platformSettings, "resolve").mockResolvedValue(null);
    const raise = jest.spyOn(alertRouting, "raise").mockResolvedValue({});

    await handler();
    expect(raise).not.toHaveBeenCalled();
  });

  test("crossing 80%: one alert, and the crossing is recorded", async () => {
    at(80);
    jest.spyOn(platformSettings, "resolve").mockResolvedValue(null);
    const put = jest.spyOn(platformSettings, "put").mockResolvedValue({});
    const raise = jest.spyOn(alertRouting, "raise").mockResolvedValue({});

    await handler();

    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toMatchObject({ event: "qes.quota_low", severity: "notify" });
    expect(raise.mock.calls[0][0].subject).toContain("80%");
    // The dedupe state was written with the 80 crossing marked.
    expect(put).toHaveBeenCalled();
    const stateArg = put.mock.calls[0][0];
    expect(stateArg.value.alerted80).toBe(true);
    expect(stateArg.value.alerted95).toBeUndefined();
  });

  test("a second sweep the same month does not re-alert the same threshold", async () => {
    at(84);
    const state = { month: currentMonth(), alerted80: true };
    jest.spyOn(platformSettings, "resolve").mockResolvedValue({ value: state });
    const put = jest.spyOn(platformSettings, "put").mockResolvedValue({});
    const raise = jest.spyOn(alertRouting, "raise").mockResolvedValue({});

    await handler();

    expect(raise).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  test("crossing 95% alerts 95, and does not re-alert the 80 already sent", async () => {
    at(95);
    const state = { month: currentMonth(), alerted80: true };
    jest.spyOn(platformSettings, "resolve").mockResolvedValue({ value: state });
    const put = jest.spyOn(platformSettings, "put").mockResolvedValue({});
    const raise = jest.spyOn(alertRouting, "raise").mockResolvedValue({});

    await handler();

    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0].subject).toContain("95%");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0].value).toMatchObject({ alerted80: true, alerted95: true });
  });

  test("a NEW month resets the dedupe: 80% again is a fresh alert", async () => {
    at(80);
    // Last month's crossings — they do not carry over.
    jest.spyOn(platformSettings, "resolve").mockResolvedValue({
      value: { month: "1999-01", alerted80: true, alerted95: true },
    });
    const raise = jest.spyOn(alertRouting, "raise").mockResolvedValue({});
    jest.spyOn(platformSettings, "put").mockResolvedValue({});

    await handler();

    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0].subject).toContain("80%");
  });
});
