"use strict";
/**
 * Calls audit D1: each call's deadlines are its own delayed jobs, and the
 * safety sweep visits only tenants with recent calls, every 5 minutes. The
 * PR-1 sweep ran every 15 s, one job per tenant×env for the whole fleet,
 * including tenants that had never made a call.
 */
jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({})) }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: jest.fn(async () => []),
  withTenantConnection: jest.fn(async (_meta, _env, fn) => fn({})),
}));
jest.mock("../../src/modules/smartcomm/smartcomm.call.service", () => ({
  sweep: jest.fn(async () => ({ moved: 0, live: 0 })),
  expireRing: jest.fn(async () => ({ moved: true })),
  capCall: jest.fn(async () => ({ moved: true })),
  checkLiveness: jest.fn(async () => ({ moved: false })),
}));

const redis = require("../../src/config/redis").__fake;
const { enqueue } = require("../../src/jobs/queue-producer");
const registry = require("../../src/services/tenant/registry.service");
const callService = require("../../src/modules/smartcomm/smartcomm.call.service");
const clock = require("../../src/modules/smartcomm/smartcomm.call.clock");
const scheduler = require("../../src/jobs/handlers/comms-call-sweep-scheduler");
const sweepJob = require("../../src/jobs/handlers/comms-call-sweep");
const clockJob = require("../../src/jobs/handlers/comms-call-clock");
const schedule = require("../../src/jobs/call-record-sweep-schedule");
const { config } = require("../../src/config/env");

const A = { slug: "acme", db_name: "tenant_acme", sandbox_schema: "sandbox" };
const B = { slug: "beta", db_name: "tenant_beta", sandbox_schema: null };
const QUIET = { slug: "quiet", db_name: "tenant_quiet", sandbox_schema: "sandbox" };

beforeEach(() => {
  redis._reset();
  enqueue.mockClear();
});

describe("the safety sweep visits only tenants with calls", () => {
  test("a fleet of three with calls at one: one sweep job, none for the quiet tenants", async () => {
    registry.listActiveTenants.mockResolvedValue([A, B, QUIET]);
    await clock.markTenantActive(A, "live");
    const out = await scheduler();
    expect(out).toEqual({ enqueued: 1 });
    expect(enqueue.mock.calls.map((c) => [c[0], c[2].tenantMeta.slug, c[2].env]))
      .toEqual([["comms-call-sweep", "acme", "live"]]);
  });

  test("with no calls anywhere it reads nothing from the platform database", async () => {
    registry.listActiveTenants.mockClear();
    expect(await scheduler()).toEqual({ enqueued: 0 });
    expect(registry.listActiveTenants).not.toHaveBeenCalled();
  });

  test("a sandbox entry for a tenant without a sandbox is skipped", async () => {
    registry.listActiveTenants.mockResolvedValue([B]);
    await clock.markTenantActive(B, "sandbox");
    expect(await scheduler()).toEqual({ enqueued: 0 });
  });

  test("a tenant leaves the set once it has no live call and has been quiet 10 minutes", async () => {
    await redis.zadd(clock.ACTIVE_TENANTS_KEY, Date.now() - 11 * 60_000, "acme|live");
    await redis.zadd(clock.ACTIVE_TENANTS_KEY, Date.now() - 60_000, "beta|live");
    callService.sweep.mockResolvedValue({ moved: 0, live: 0 });
    expect((await sweepJob({ data: { tenantMeta: A, env: "live" } })).released).toBe(true);
    expect((await sweepJob({ data: { tenantMeta: B, env: "live" } })).released).toBe(false);
    expect(await clock.activeTenants()).toEqual([{ slug: "beta", env: "live" }]);
  });

  test("a tenant with a live call stays in the set however old its entry", async () => {
    await redis.zadd(clock.ACTIVE_TENANTS_KEY, Date.now() - 60 * 60_000, "acme|live");
    callService.sweep.mockResolvedValue({ moved: 0, live: 1 });
    expect((await sweepJob({ data: { tenantMeta: A, env: "live" } })).released).toBe(false);
    expect(await clock.activeTenants()).toHaveLength(1);
  });

  test("the tick is 5 minutes by default, and the old 15 s repeatable is removed at boot", async () => {
    expect(config.COMMS_CALL_SAFETY_SWEEP_MS).toBe(300000);
    const removed = [];
    const queue = {
      getRepeatableJobs: async () => [
        { key: "old-15s", every: "15000", pattern: null },
        { key: "current", every: "300000", pattern: null },
      ],
      removeRepeatableByKey: async (k) => removed.push(k),
    };
    await schedule.removeStaleRepeatables(queue, { every: 300000 });
    expect(removed).toEqual(["old-15s"]);
  });
});

describe("the clock job routes each deadline", () => {
  test.each([["ring", "expireRing"], ["cap", "capCall"], ["liveness", "checkLiveness"]])(
    "%s → %s", async (name, fn) => {
      await clockJob({ name, data: { callId: "c1", tenantMeta: A, env: "live" } });
      expect(callService[fn]).toHaveBeenCalledWith({}, { callId: "c1", tenantMeta: A, env: "live" });
    },
  );

  test("refuses a job without a tenant or with an unknown env", async () => {
    await expect(clockJob({ name: "ring", data: { callId: "c1", env: "live" } })).rejects.toThrow();
    await expect(clockJob({ name: "ring", data: { callId: "c1", tenantMeta: A, env: "prod" } })).rejects.toThrow();
  });
});

describe("the clock never throws into a call", () => {
  test("a queue outage returns null", async () => {
    enqueue.mockRejectedValueOnce(new Error("redis down"));
    await expect(clock.scheduleRingDeadline({ callId: "c1", tenantMeta: A, env: "live", ringTimeoutS: 60 }))
      .resolves.toBeNull();
  });

  test("a Redis outage while marking the tenant is swallowed", async () => {
    redis._state.fail = true;
    await expect(clock.markTenantActive(A, "live")).resolves.toBeUndefined();
  });

  test("liveness jobs are one per call per due second", async () => {
    const at = Date.now() + 60_000;
    await clock.scheduleLiveness({ callId: "c1", tenantMeta: A, env: "live", atMs: at });
    expect(enqueue.mock.calls[0][3].jobId).toBe(`callclock-live-c1-${Math.ceil(at / 1000)}`);
  });
});

describe("the daily record sweep is spread by tenant (D2)", () => {
  const recordScheduler = require("../../src/jobs/handlers/comms-call-record-sweep-scheduler");

  test("each tenant gets a stable delay inside the 6-hour window, and tenants differ", async () => {
    registry.listActiveTenants.mockResolvedValue([A, B, QUIET]);
    await recordScheduler();
    const delays = enqueue.mock.calls.filter((c) => c[0] === "comms-call-record-sweep").map((c) => [c[2].tenantMeta.slug, c[3].delay]);
    for (const [slug, delay] of delays) {
      expect(delay).toBe(recordScheduler.spreadDelay(slug));
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(recordScheduler.SPREAD_MS);
    }
    expect(new Set(delays.map(([, d]) => d)).size).toBe(3);
  });
});
