"use strict";

/**
 * OBS-A6 (Critical) — dead-lettered business events were a silent black hole.
 *
 * `dispatcher.js` marked an event DEAD after 5 attempts and stored `last_error`,
 * and then:
 *
 *   · the log line was `warn`, and BYTE-IDENTICAL for a retriable FAILED and a
 *     terminal DEAD — so there was no way to alert on "gave up permanently"
 *   · nothing, anywhere, ever queried `event_dispatch WHERE status = 'DEAD'`
 *
 * The handlers that die there are the cross-module money flows:
 * costing-approved → draft invoice, supplier-invoice-posted → cost entry,
 * receipt-posted → collected signal. An approved costing that should raise a
 * draft invoice simply never raised one — permanently — while the app returned
 * 200s and nobody found out until a human noticed a missing invoice.
 *
 * Three things are asserted here, and the middle one is the point: a retriable
 * failure must stay quiet, or the alert channel becomes noise and gets muted.
 */

const path = require("path");

const DISPATCHER = "../../src/orchestration/dispatcher";
const JOB = "../../src/jobs/handlers/orchestration-dispatch";

describe("OBS-A6 — DEAD is distinguishable from FAILED", () => {
  /** Minimal client that returns one pending event on the backlog query. */
  function fakeClient(attempts) {
    const queries = [];
    return {
      queries,
      query: async (sql, params) => {
        queries.push([sql, params]);
        if (/FROM event_log el LEFT JOIN event_dispatch/.test(sql)) {
          return {
            rows: [
              { event_id: "e1", event_type_key: "test.evt", entity_ref: "x:1", payload: {}, attempts },
            ],
          };
        }
        return { rows: [] };
      },
    };
  }

  function load() {
    jest.resetModules();
    const registry = require("../../src/orchestration/registry");
    registry.register({
      eventKey: "test.evt",
      handlerKey: "test-handler",
      feature: null,
      run: async () => { throw new Error("handler blew up"); },
    });
    const reporter = require("../../src/shared/observability/error-reporter");
    reporter.__reset();
    const sent = [];
    jest.spyOn(reporter, "report").mockImplementation((err, meta) => {
      sent.push({ err, meta });
      return Promise.resolve({ reported: true });
    });
    return { dispatcher: require(DISPATCHER), sent };
  }

  afterEach(() => jest.restoreAllMocks());

  it("writes FAILED while retries remain", async () => {
    const { dispatcher } = load();
    const client = fakeClient(0);
    const res = await dispatcher.dispatchPending(client, { limit: 10, maxAttempts: 5 });

    const write = client.queries.find(([s]) => /INSERT INTO event_dispatch/.test(s));
    expect(write[1][1]).toBe("FAILED");
    expect(res.dead).toBe(0);
  });

  it("does NOT notify on a retriable failure", async () => {
    // If a retry that will be retried pages someone, the channel is noise
    // within a day and gets muted — which is the state OBS-A1 describes.
    const { dispatcher, sent } = load();
    await dispatcher.dispatchPending(fakeClient(0), { limit: 10, maxAttempts: 5 });
    expect(sent).toHaveLength(0);
  });

  it("writes DEAD on the final attempt and reports it as fatal", async () => {
    const { dispatcher, sent } = load();
    const client = fakeClient(4);
    const res = await dispatcher.dispatchPending(client, { limit: 10, maxAttempts: 5 });

    const write = client.queries.find(([s]) => /INSERT INTO event_dispatch/.test(s));
    expect(write[1][1]).toBe("DEAD");
    expect(res.dead).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].meta.severity).toBe("fatal");
    expect(sent[0].meta.extra).toMatchObject({ event_type_key: "test.evt", dropped: true });
  });
});

describe("OBS-A6 — the query that never existed", () => {
  it("filters on status = 'DEAD' and groups by event type", async () => {
    jest.resetModules();
    const { countDeadLetters } = require(DISPATCHER);
    let sqlSeen = "";
    const client = {
      query: async (sql) => {
        sqlSeen = sql;
        return {
          rows: [
            { event_type_key: "costing.approved", count: 3, oldest: "2026-08-01", last_error: "boom" },
            { event_type_key: "receipt.posted", count: 1, oldest: "2026-08-02", last_error: "x" },
          ],
        };
      },
    };

    const dl = await countDeadLetters(client);
    expect(sqlSeen).toMatch(/status\s*=\s*'DEAD'/);
    expect(dl.total).toBe(4);
    expect(dl.byType).toHaveLength(2);
  });
});

describe("OBS-A6 — the sweep surfaces a standing backlog", () => {
  function loadJob({ deadTotal, dispatchDead }) {
    jest.resetModules();
    jest.doMock("../../src/services/tenant/registry.service", () => ({
      withTenantConnection: async (_m, _e, fn) => fn({}),
      listActiveTenants: async () => [{ slug: "smartls" }],
    }));
    jest.doMock(DISPATCHER, () => ({
      dispatchPending: async () => ({ scanned: 1, processed: 0, failed: 0, dead: dispatchDead, skipped: 0 }),
      countDeadLetters: async () => ({
        total: deadTotal,
        byType: deadTotal ? [{ event_type_key: "costing.approved", count: deadTotal }] : [],
      }),
    }));
    const reporter = require("../../src/shared/observability/error-reporter");
    reporter.__reset();
    const sent = [];
    jest.spyOn(reporter, "report").mockImplementation((err, meta) => {
      sent.push({ err, meta });
      return Promise.resolve({ reported: true });
    });
    const job = require(JOB);
    job.__resetDeadLetterNotifications();
    return { job, sent };
  }

  afterEach(() => jest.restoreAllMocks());

  it("says nothing when the backlog is clean", async () => {
    const { job, sent } = loadJob({ deadTotal: 0, dispatchDead: 0 });
    const res = await job({ data: { tenantMeta: { slug: "smartls" }, env: "live" } });
    expect(res.dead_letters).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("notifies when something newly dies, with the breakdown", async () => {
    const { job, sent } = loadJob({ deadTotal: 3, dispatchDead: 1 });
    const res = await job({ data: { tenantMeta: { slug: "smartls" }, env: "live" } });
    expect(res.dead_letters).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0].meta.extra).toMatchObject({ total: 3 });
  });

  it("does not re-notify on every sweep while a backlog just sits", async () => {
    // Re-raised daily instead (DEAD_LETTER_RENOTIFY_MS) so it cannot be
    // forgotten, without a page every 30 seconds.
    const { job, sent } = loadJob({ deadTotal: 3, dispatchDead: 0 });
    await job({ data: { tenantMeta: { slug: "smartls" }, env: "live" } });
    sent.length = 0;
    await job({ data: { tenantMeta: { slug: "smartls" }, env: "live" } });
    await job({ data: { tenantMeta: { slug: "smartls" }, env: "live" } });
    expect(sent).toHaveLength(0);
  });

  it("a census failure does not fail the drain", async () => {
    // The backlog is a business problem to action, not a reason to stop
    // draining the events that still work.
    jest.resetModules();
    jest.doMock("../../src/services/tenant/registry.service", () => ({
      withTenantConnection: async (_m, _e, fn) => fn({}),
    }));
    jest.doMock(DISPATCHER, () => ({
      dispatchPending: async () => ({ scanned: 0, processed: 0, failed: 0, dead: 0, skipped: 0 }),
      countDeadLetters: async () => { throw new Error("census exploded"); },
    }));
    const job = require(JOB);
    await expect(
      job({ data: { tenantMeta: { slug: "smartls" }, env: "live" } }),
    ).resolves.toBeDefined();
  });
});

describe("OBS-A6 — readiness exposes it on demand", () => {
  it("reports the total, marks degraded, and stays 200", async () => {
    // Degraded rather than 503: dropped events are a business failure, not a
    // reason to fail a deploy gate or restart containers.
    jest.resetModules();
    const express = require("express");
    const request = require("supertest");

    jest.doMock("../../src/services/platform/db", () => ({ query: async () => ({ rows: [{}] }) }));
    jest.doMock("../../src/config/redis", () => ({ getClient: () => ({ ping: async () => "PONG" }) }));
    jest.doMock("../../src/shared/http/module-loader", () => ({
      mountReport: () => ({ mounted: ["a/b"], skipped: [] }),
    }));
    jest.doMock("../../src/services/tenant/registry.service", () => ({
      listActiveTenants: async () => [{ slug: "smartls" }],
      withTenantConnection: async (_m, _e, fn) => fn({}),
    }));
    jest.doMock(DISPATCHER, () => ({
      countDeadLetters: async () => ({ total: 2, byType: [] }),
      dispatchPending: async () => ({}),
    }));

    const { router } = require("../../src/routes/health");
    const app = express();
    app.use("/api", router);

    const res = await request(app).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.dead_letters.total).toBe(2);
    expect(res.body.checks.dead_letters.by_tenant.smartls).toBe(2);
  });
});

void path;
