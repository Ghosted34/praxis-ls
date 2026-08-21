/**
 * THE TICK THAT MAKES SCHEDULED REPORTS RUN.
 *
 * `scheduled-report` was a registered worker with no producer for its whole
 * life. Its header deferred the trigger to "an app scheduled-task or external
 * cron", which was a deployment dependency written down nowhere else, on a
 * fleet where every other periodic job is registered in `scheduleRecurring()`.
 *
 * The symptom was quiet in the way this programme keeps finding: a tenant
 * scheduled a weekly receivables report, got a `scheduled_report` row, watched
 * `next_run_at` arrive and then stay in the past, and received nothing. Every
 * test passed. The route worked. Nobody was calling it.
 *
 * So the tests below are about the fan-out's shape rather than about report
 * generation, which `report.runDue` already owns and tests.
 */
"use strict";

jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({})) }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: jest.fn(async () => []),
  withTenantConnection: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const { enqueue } = require("../../src/jobs/queue-producer");
const registry = require("../../src/services/tenant/registry.service");
const scheduler = require("../../src/jobs/handlers/scheduled-report-scheduler");
const handler = require("../../src/jobs/handlers/scheduled-report");

const TENANTS = [{ db_name: "acme" }, { db_name: "camrail" }];

beforeEach(() => {
  jest.clearAllMocks();
  registry.listActiveTenants.mockResolvedValue(TENANTS);
});

describe("it fans out, one job per live tenant", () => {
  test("every active tenant gets a job", async () => {
    const out = await scheduler();
    expect(out).toMatchObject({ tenants: 2, enqueued: 2, skipped: 0 });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      "scheduled-report", "run-due",
      expect.objectContaining({ tenantMeta: TENANTS[0], env: "live" }),
      expect.anything(),
    );
  });

  test("LIVE only", async () => {
    await scheduler();
    for (const call of enqueue.mock.calls) expect(call[2].env).toBe("live");
    // A Test run would generate the report, have its mail suppressed by
    // email.service's sandbox guard, and still consume `next_run_at` — a
    // rehearsal that spends the schedule without rehearsing anything.
  });

  test("one unreachable tenant does not stop the rest", async () => {
    enqueue.mockRejectedValueOnce(new Error("redis unreachable"));
    const out = await scheduler();
    expect(out).toMatchObject({ tenants: 2, enqueued: 1, skipped: 1 });
    // The whole point of a per-tenant job is isolation.
  });

  test("no tenants is a quiet no-op, not a failure", async () => {
    registry.listActiveTenants.mockResolvedValue([]);
    await expect(scheduler()).resolves.toMatchObject({ tenants: 0, enqueued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("a slow tenant never piles up", () => {
  test("the job id is per tenant per hour", async () => {
    await scheduler();
    const ids = enqueue.mock.calls.map((c) => c[3].jobId);
    expect(ids[0]).toMatch(/^schedreport:acme:live-\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(new Set(ids).size).toBe(2);
  });

  test("the id has no fourth colon", async () => {
    await scheduler();
    // BullMQ allows `:` in a custom id only when it splits into exactly three
    // segments; a fourth throws `Custom Id cannot contain :`. Hence
    // `live-<hour>` rather than `live:<hour>` — the same shape, and the same
    // trap, as regie-aging-scheduler.
    for (const c of enqueue.mock.calls) {
      expect(c[3].jobId.split(":")).toHaveLength(3);
    }
  });

  test("one attempt — the next hour's tick is the retry", async () => {
    await scheduler();
    // Re-running the whole sweep on a transient failure would re-generate
    // reports whose emails already went out; those emails are queued with their
    // own retries.
    for (const c of enqueue.mock.calls) expect(c[3].attempts).toBe(1);
  });
});

describe("the worker it feeds", () => {
  test("refuses a job with no tenant rather than guessing one", async () => {
    await expect(handler({ data: {} })).rejects.toThrow(/tenantMeta/);
  });
});

describe("the tick is registered, and often enough to mean anything", () => {
  const workers = fs.readFileSync(path.resolve(__dirname, "../../src/jobs/workers.js"), "utf8");
  const env = fs.readFileSync(path.resolve(__dirname, "../../src/config/env.js"), "utf8");

  test("the worker table registers the scheduler", () => {
    expect(workers).toMatch(/name: "scheduled-report-scheduler"/);
  });

  test("scheduleRecurring enqueues it", () => {
    const recurring = workers.slice(workers.indexOf("async function scheduleRecurring"));
    expect(recurring).toMatch(/enqueue\("scheduled-report-scheduler"/);
  });

  test("HOURLY, because the interval is the feature's resolution", () => {
    const m = env.match(/SCHEDULED_REPORT_CRON: z\.string\(\)\.default\("([^"]+)"\)/);
    expect(m).toBeTruthy();
    const [minute, hour] = m[1].split(" ");
    // `next_run_at` is a timestamp and the due query asks `<= now()`. A daily
    // tick would make every cadence a tenant can choose mean "whenever the cron
    // fires", so a Monday-morning report arrives at the fleet cron's hour.
    expect(hour).toBe("*");
    // Off the hour: every other scheduler fires at :00.
    expect(Number(minute)).toBeGreaterThan(0);
  });

  test("an empty cron disables it rather than crashing the runtime", () => {
    const recurring = workers.slice(workers.indexOf("async function scheduleRecurring"));
    expect(recurring).toMatch(/scheduled-report scheduler disabled/);
  });
});
