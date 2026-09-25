"use strict";

/**
 * Smart Comms call metrics (PR-3, §7.2/§7.4.4) — the aggregation, the read model
 * and the alarm.
 *
 * The three things this file exists to hold still:
 *
 *   1. THE AGGREGATION'S SHAPE. The upsert is keyed (tenant_slug, env,
 *      metric_date) and carries the reasons as their own jsonb — a metric row
 *      that loses its reasons is an alarm nobody can act on, and a GROUP BY
 *      that folded reasons into the outcome counts would corrupt every other
 *      column on the row. The fake below encodes the two queries' answers and
 *      asserts the write that came out.
 *   2. THE READ MODEL'S ARITHMETIC. The average duration over a range is
 *      WEIGHTED by the calls it came from. Averaging the stored averages is the
 *      classic version of this bug: one call on a quiet tenant then counts as
 *      much as a thousand on a busy one.
 *   3. THE ALARM'S RESTRAINT. Threshold, window, and — the part that decides
 *      whether anyone still reads the alert — no second page inside the window.
 */

jest.mock("../../src/services/tenant/registry.service", () => ({
  listActiveTenants: jest.fn(async () => []),
  withTenantConnection: jest.fn(),
}));
jest.mock("../../src/services/platform/db", () => ({
  query: jest.fn(),
  opsQuery: jest.fn(),
}));
jest.mock("../../src/services/platform/alert-routing.service", () => ({
  raise: jest.fn(async () => ({ delivered: true, reason: "sent" })),
}));
jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
jest.mock("../../src/services/platform/runtime-config.service", () => ({
  opsTuning: jest.fn(async () => ({ source: "defaults" })),
}));

const registry = require("../../src/services/tenant/registry.service");
const db = require("../../src/services/platform/db");
const alerts = require("../../src/services/platform/alert-routing.service");
const metrics = require("../../src/services/platform/comms-metrics.service");

const TENANT = { slug: "smartls", tenant_id: "11111111-1111-4111-8111-111111111111" };

beforeEach(() => {
  jest.clearAllMocks();
  require("../../src/config/redis").__fake._reset();
  db.opsQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  db.query.mockImplementation((...a) => db.opsQuery(...a));
  registry.listActiveTenants.mockResolvedValue([]);
  registry.withTenantConnection.mockReset();
  alerts.raise.mockResolvedValue({ delivered: true, reason: "sent" });
  require("../../src/services/platform/runtime-config.service").opsTuning.mockResolvedValue({
    source: "defaults",
  });
});

/* ── The aggregation ─────────────────────────────────────────────────────── */

/** A tenant client whose two aggregation queries return fixed rows. */
function tenantClient({ days = [], reasons = [] } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/transcription_error/.test(sql)) return { rows: reasons };
      return { rows: days };
    }),
  };
}

describe("aggregateTenant", () => {
  test("one day row becomes one upserted metric row, reasons and all", async () => {
    const client = tenantClient({
      days: [
        {
          metric_date: "2026-09-19T00:00:00.000Z",
          calls_started: 9, calls_answered: 7, calls_no_answer: 1, calls_declined: 1,
          calls_busy: 0, calls_failed: 0, avg_duration_seconds: 240,
          transcription_failed: 2,
          ring_socket: 6, ring_notification: 2, ring_push: 1, ring_none: 0,
        },
      ],
      reasons: [
        { metric_date: "2026-09-19T00:00:00.000Z", reason: "provider timeout", n: 1 },
        { metric_date: "2026-09-19T00:00:00.000Z", reason: "upload never arrived", n: 1 },
      ],
    });
    registry.withTenantConnection.mockImplementation(async (_m, _e, fn) => fn(client));

    const out = await metrics.aggregateTenant({ tenantMeta: TENANT, env: "live" });
    expect(out.written).toBe(1);

    const [sql, params] = db.opsQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO platform.comms_call_metric");
    expect(sql).toContain("ON CONFLICT (tenant_slug, env, metric_date) DO UPDATE");
    expect(params.slice(0, 3)).toEqual(["smartls", "live", "2026-09-19"]);
    // The reasons travel as their own jsonb, keyed by day: the alarm's detail
    // is what makes it actionable, and it is written in the same statement as
    // the count it belongs to.
    expect(JSON.parse(params[11])).toEqual({
      "provider timeout": 1,
      "upload never arrived": 1,
    });
    expect(params[12]).toBe(6); // ring_socket
    expect(params[15]).toBe(0); // ring_none
  });

  test("a tenant whose aggregation fails does not take the fleet down with it", async () => {
    registry.listActiveTenants.mockResolvedValue([
      TENANT,
      { slug: "broken", tenant_id: "22222222-2222-4222-8222-222222222222" },
      { slug: "smartls-sandbox", tenant_id: "33333333-3333-4333-8333-333333333333", sandbox_schema: "sandbox" },
    ]);
    registry.withTenantConnection.mockImplementation(async (tenantMeta, env, fn) => {
      if (tenantMeta.slug === "broken") throw new Error("connection refused");
      return fn(tenantClient({ days: [] }));
    });

    const out = await metrics.aggregateFleet();
    expect(out.errors).toEqual([{ tenant: "broken", env: "live", message: "connection refused" }]);
    // The tenant with a sandbox schema is aggregated twice — the sandbox is a
    // separate database with its own calls, and folding them into `live` would
    // make a demo look like production traffic.
    const envs = out.results.map((r) => `${r.tenant}:${r.env}`).sort();
    expect(envs).toEqual(["smartls-sandbox:live", "smartls-sandbox:sandbox", "smartls:live"]);
  });
});

/* ── The read model ──────────────────────────────────────────────────────── */

describe("overview", () => {
  test("totals add up and the mean duration is weighted by answered calls", async () => {
    db.opsQuery.mockResolvedValue({
      rows: [
        {
          tenant_slug: "busy", env: "live", metric_date: "2026-09-19",
          calls_started: 10, calls_answered: 10, calls_failed: 0,
          avg_duration_seconds: 600, transcription_failed: 0,
          transcription_failed_reasons: {},
          ring_socket: 8, ring_notification: 2, ring_push: 0, ring_none: 0,
          transcription_alert_at: null, computed_at: "2026-09-20T00:20:00.000Z",
        },
        {
          tenant_slug: "quiet", env: "live", metric_date: "2026-09-19",
          calls_started: 1, calls_answered: 1, calls_failed: 0,
          avg_duration_seconds: 60, transcription_failed: 1,
          transcription_failed_reasons: { "provider timeout": 1 },
          ring_socket: 0, ring_notification: 0, ring_push: 1, ring_none: 0,
          transcription_alert_at: null, computed_at: "2026-09-20T00:20:00.000Z",
        },
      ],
    });

    const out = await metrics.overview({ days: 7 });
    expect(out.fleet.started).toBe(11);
    expect(out.fleet.answered).toBe(11);
    // (600×10 + 60×1) / 11 — NOT (600+60)/2.
    expect(out.fleet.avg_duration_seconds).toBe(551);
    expect(out.fleet.reasons).toEqual({ "provider timeout": 1 });
    expect(out.fleet.ring_socket).toBe(8);
    expect(out.fleet.ring_push).toBe(1);
    expect(out.fleet.duration_weighted).toBeUndefined();
    expect(out.tenants.map((t) => t.tenant_slug)).toEqual(["busy", "quiet"]);
    // The ring split is what tells ops how hard the push tier is working.
    expect(out.tenants[1].rings).toEqual({ socket: 0, notification: 0, push: 1, none: 0 });
    expect(out.tenants[1].ring_acknowledged).toBe(1);
  });

  test("the window is clamped: a console cannot ask for a year of full scans", async () => {
    db.opsQuery.mockResolvedValue({ rows: [] });
    await metrics.overview({ days: 99999 });
    expect(db.opsQuery.mock.calls[0][1]).toEqual([400]);
  });
});

/* ── The alarm ───────────────────────────────────────────────────────────── */

const metricRow = (over = {}) => ({
  tenant_slug: "smartls",
  failed: 0,
  last_alert_at: null,
  ...over,
});

describe("evaluateTranscriptionAlert", () => {
  test("below the threshold is not an alarm", async () => {
    db.opsQuery.mockResolvedValue({ rows: [metricRow({ failed: 2 })] });
    const out = await metrics.evaluateTranscriptionAlert({ threshold: 3, windowHours: 24 });
    expect(out.raised).toHaveLength(0);
    expect(out.skipped).toEqual([{ tenant: "smartls", failed: 2, reason: "below threshold" }]);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  test("at the threshold it pages, with the reasons attached", async () => {
    db.opsQuery
      .mockResolvedValueOnce({ rows: [metricRow({ failed: 4 })] })
      .mockResolvedValueOnce({
        rows: [{ transcription_failed_reasons: { "provider timeout": 3, "upload never arrived": 1 } }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const out = await metrics.evaluateTranscriptionAlert({ threshold: 3, windowHours: 24 });
    expect(out.raised).toHaveLength(1);
    const args = alerts.raise.mock.calls[0][0];
    expect(args.event).toBe("comms.transcription_sustained");
    expect(args.tenant).toBe("smartls");
    expect(args.detail).toMatchObject({
      failed: 4,
      threshold: 3,
      window_hours: 24,
      reasons: { "provider timeout": 3, "upload never arrived": 1 },
    });
  });

  test("a condition that persists pages once per window, not once per tick", async () => {
    const stamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // an hour ago
    db.opsQuery.mockResolvedValue({ rows: [metricRow({ failed: 9, last_alert_at: stamp })] });
    const out = await metrics.evaluateTranscriptionAlert({ threshold: 3, windowHours: 24 });
    expect(out.raised).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/already raised/);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  test("the threshold and window come from the vault before the environment", async () => {
    require("../../src/services/platform/runtime-config.service").opsTuning.mockResolvedValue({
      commsTranscriptionAlertThreshold: 5,
      commsTranscriptionAlertWindowHours: 72,
      source: "vault",
    });
    db.opsQuery.mockResolvedValue({ rows: [metricRow({ failed: 4 })] });
    const out = await metrics.evaluateTranscriptionAlert();
    expect(out).toMatchObject({ threshold: 5, window_hours: 72 });
    expect(alerts.raise).not.toHaveBeenCalled();

    const cfg = await metrics.alertConfig();
    expect(cfg).toEqual({ threshold: 5, window_hours: 72, source: "vault" });
  });
});

/* ── PR-5: counters, UTC days, live-only alarm, latency ──────────────────── */

describe("the hourly refresh reads no tenant database (audit D4)", () => {
  const signals = require("../../src/modules/smartcomm/smartcomm.call.signals");
  const NOW = new Date("2026-09-25T14:00:00Z");
  const started = "2026-09-25T09:30:00Z";

  test("today's rows come from the day counters the call service increments", async () => {
    const c = (field, by = 1, env = "live") => signals.count({ slug: "acme", env, field, by, startedAt: started });
    await c("calls_started", 5);
    await c("calls_answered", 3);
    await c("calls_no_answer", 2);
    await c("answered_ended", 2);
    await c("duration_sum", 600);
    await c("ring_socket", 2);
    await c("ring_push", 1);
    await c("transcription_failed", 1);
    await c("reason:PARTS_NOT_TRANSCRIBED", 1);
    await c("calls_started", 1, "sandbox");

    const handler = require("../../src/jobs/handlers/comms-call-metrics");
    const spy = jest.spyOn(metrics, "refreshFromCounters");
    const out = await metrics.refreshFromCounters({ now: NOW });
    expect(out).toEqual({ written: 2, source: "counters" });
    expect(registry.withTenantConnection).not.toHaveBeenCalled();
    const live = db.opsQuery.mock.calls.map((x) => x[1]).find((p) => p[1] === "live");
    expect(live.slice(0, 11)).toEqual(["acme", "live", "2026-09-25", 5, 3, 2, 0, 0, 0, 300, 1]);
    expect(JSON.parse(live[11])).toEqual({ PARTS_NOT_TRANSCRIBED: 1 });
    expect(live.slice(12)).toEqual([2, 0, 1, 2]); // ring_none = started - acked

    // The job's hourly tick uses the counters, never the fleet fan-out.
    db.opsQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await handler({ name: "alert" });
    expect(spy).toHaveBeenCalled();
    expect(registry.listActiveTenants).not.toHaveBeenCalled();
  });
});

describe("UTC days (audit D11)", () => {
  test("the aggregation computes the day in SQL, in UTC, as text", async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    registry.withTenantConnection.mockImplementation(async (_m, _e, fn) => fn(client));
    await metrics.aggregateTenant({ tenantMeta: TENANT, env: "live" });
    for (const [sql] of client.query.mock.calls) {
      expect(sql).toContain("(started_at AT TIME ZONE 'UTC')::date::text");
      expect(sql).not.toContain("date_trunc('day', started_at)");
    }
  });

  test("a text day is written as it came, whatever the process timezone", async () => {
    const client = {
      query: jest.fn(async (sql) => (/transcription_error/.test(sql) ? { rows: [] }
        : { rows: [{ metric_date: "2026-09-19", calls_started: 1, calls_answered: 0, calls_no_answer: 1, calls_declined: 0, calls_busy: 0, calls_failed: 0, avg_duration_seconds: null, transcription_failed: 0, ring_socket: 0, ring_notification: 0, ring_push: 0, ring_none: 1 }] })),
    };
    registry.withTenantConnection.mockImplementation(async (_m, _e, fn) => fn(client));
    await metrics.aggregateTenant({ tenantMeta: TENANT, env: "live" });
    expect(db.opsQuery.mock.calls[0][1][2]).toBe("2026-09-19");
  });
});

describe("the failure alarm is per tenant and env, live only (D5, N5)", () => {
  test("the read groups by (tenant, env) and keeps only live", async () => {
    db.opsQuery.mockResolvedValue({ rows: [] });
    await metrics.evaluateTranscriptionAlert({ threshold: 3, windowHours: 24 });
    const [sql] = db.opsQuery.mock.calls[0];
    expect(sql).toMatch(/GROUP BY tenant_slug, env/);
    expect(sql).toMatch(/env = 'live'/);
  });

  test("the subject no longer blames a browser capture that does not exist", async () => {
    db.opsQuery
      .mockResolvedValueOnce({ rows: [metricRow({ failed: 4, env: "live" })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await metrics.evaluateTranscriptionAlert({ threshold: 3, windowHours: 24 });
    const { subject } = alerts.raise.mock.calls[0][0];
    expect(subject).not.toMatch(/browser/i);
    expect(subject).toBe("4 calls could not be fully transcribed in the last 24h (threshold 3)");
  });
});

describe("the latency alarm (§4 item 8)", () => {
  const signals = require("../../src/modules/smartcomm/smartcomm.call.signals");

  test("pages once when a live tenant's p95 hang-up→summary is over target", async () => {
    for (let i = 0; i < 19; i += 1) await signals.summaryLatency({ slug: "slow", env: "live", callId: `c${i}`, seconds: 60 });
    await signals.summaryLatency({ slug: "slow", env: "live", callId: "late", seconds: 400 });
    await signals.summaryLatency({ slug: "fine", env: "live", callId: "f", seconds: 40 });
    await signals.summaryLatency({ slug: "demo", env: "sandbox", callId: "d", seconds: 900 });
    let out = await metrics.evaluateLatencyAlert({ p95Seconds: 120, backlogSeconds: 600 });
    expect(out.raised.map((r) => r.tenant)).toEqual([]);
    // p95 of 20 samples is the 19th value: 60 s. Add one more slow call.
    await signals.summaryLatency({ slug: "slow", env: "live", callId: "late2", seconds: 500 });
    out = await metrics.evaluateLatencyAlert({ p95Seconds: 120, backlogSeconds: 600 });
    expect(out.raised).toEqual([expect.objectContaining({ tenant: "slow", slow: true })]);
    expect(alerts.raise.mock.calls[0][0].event).toBe("comms.transcription_latency");
    out = await metrics.evaluateLatencyAlert({ p95Seconds: 120, backlogSeconds: 600 });
    expect(out.raised).toEqual([]);
  });

  test("pages when a tenant's oldest waiting part is older than its limit", async () => {
    await signals.partQueued({ slug: "stuck", env: "live", jobId: "p1", now: Date.now() - 20 * 60_000 });
    const out = await metrics.evaluateLatencyAlert({ p95Seconds: 120, backlogSeconds: 600 });
    expect(out.raised).toEqual([expect.objectContaining({ tenant: "stuck", stuck: true })]);
    const s = out.signals.find((x) => x.tenant === "stuck");
    expect(s.oldest_waiting_s).toBeGreaterThanOrEqual(1199);
  });
});
