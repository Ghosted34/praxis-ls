"use strict";

/**
 * In-house notifications (§3.3, §5.3) and the uptime figure (§8.2).
 *
 * These two closed the last entries in the testing doc's gap table, and both
 * have a failure mode that is invisible from the outside:
 *
 *   NOTIFICATIONS fail by being LOST. The old implementation emitted a socket
 *   event and nothing else — it worked in every demo, because in a demo someone
 *   is looking at the screen. The assertions here are therefore mostly about the
 *   ROW: that it is written before the push, that a push failure cannot prevent
 *   it, and that the audience is resolved from RBAC rather than a list someone
 *   has to remember to update.
 *
 *   UPTIME fails by being FLATTERING. A collector that only writes while it is
 *   running cannot record its own outage, so `avg(healthy)` reports 100% for a
 *   week with three pages in it. The assertions below are almost entirely about
 *   the denominator being EXPECTED samples rather than present ones.
 */

const path = require("path");

const NOTIF = "../../src/services/platform/notifications.service";
const HEALTH = "../../src/services/platform/health.service";
const DB = path.join(__dirname, "../../src/services/platform/db");

/**
 * Load a service with a stubbed platform pool.
 *
 * `jest.doMock` rather than `jest.mock`: doMock is the UN-HOISTED form, so the
 * factory may legally close over `handler`. scripts/check-jest-mock-hoisting.js
 * exempts it for exactly this reason.
 */
function withDb(handler, modulePath) {
  jest.resetModules();
  jest.doMock(DB, () => ({ query: handler }));

  return require(modulePath);
}

// ───────────────────────────────────────────────────────────────────────────
describe("notifications — the row is the delivery", () => {
  it("writes before pushing, and a dead socket cannot lose the notification", async () => {
    const written = [];
    const svc = withDb(async (sql, params) => {
      written.push({ sql, params });
      return { rows: [{ id: "n-1", to_user_id: params[0], title: params[3], body: params[4] }] };
    }, NOTIF);

    // The realtime layer throwing is the normal case at 3am, not an edge case.
    jest.doMock("../../src/realtime/platform-ns", () => ({
      pushNotification: () => {
        throw new Error("no namespace");
      },
    }));

    const row = await svc.create({
      toUserId: "u-1",
      type: "error_escalation",
      title: "[FATAL] shipments",
      body: "boom — 23 occurrences",
      metadata: { error_signature: "sig-1" },
    });

    expect(written).toHaveLength(1);
    expect(written[0].sql).toMatch(/INSERT INTO platform\.notification/);
    // Returned despite the push throwing. If this rejects, one broken socket
    // takes down the escalation path that email and webhook share.
    expect(row.id).toBe("n-1");
  });

  it("clamps hostile title and body lengths", async () => {
    let params = null;
    const svc = withDb(async (_sql, p) => {
      params = p;
      return { rows: [{ id: "n-1" }] };
    }, NOTIF);

    await svc.create({ toUserId: "u-1", title: "t".repeat(5000), body: "b".repeat(99_999) });

    expect(params[3].length).toBeLessThanOrEqual(300);
    expect(params[4].length).toBeLessThanOrEqual(4000);
  });
});

describe("notifications — the audience comes from RBAC, not a list", () => {
  it("includes root admins even though no row grants them the capability", async () => {
    // Root bypasses requireCap at the HTTP layer, so a query that only joined
    // platform_role_permission would silently exclude the people who can see
    // everything — the exact opposite of the intended audience.
    let sql = null;
    const svc = withDb(async (q) => {
      sql = q;
      return { rows: [{ platform_user_id: "root-1" }, { platform_user_id: "ops-1" }] };
    }, NOTIF);

    const ids = await svc.capableUserIds("errors.read");

    expect(ids).toEqual(["root-1", "ops-1"]);
    expect(sql).toMatch(/PLATFORM_ROOT_ADMIN/);
    expect(sql).toMatch(/u\.is_active/);
  });

  it("suppresses a repeat for the same recipient and signature", async () => {
    const created = [];
    const svc = withDb(async (sql, params) => {
      if (/SELECT DISTINCT u\.platform_user_id/s.test(sql)) {
        return { rows: [{ platform_user_id: "a" }, { platform_user_id: "b" }] };
      }
      // "a" was told 5 minutes ago; "b" has not been.
      if (/SELECT 1 FROM platform\.notification/s.test(sql)) {
        return { rows: params[0] === "a" ? [{}] : [] };
      }
      created.push(params[0]);
      return { rows: [{ id: `n-${params[0]}` }] };
    }, NOTIF);

    const out = await svc.notifyCapable({
      title: "t",
      body: "b",
      metadata: { error_signature: "sig-1" },
    });

    expect(out).toMatchObject({ sent: 1, suppressed: 1, recipients: 2 });
    expect(created).toEqual(["b"]);
  });

  it("never throws on the escalation path", async () => {
    const svc = withDb(async () => {
      throw new Error("platform db unreachable");
    }, NOTIF);

    // The caller is the escalation evaluator. If this rejects, a notification
    // failure also cancels the email and the webhook for the same incident.
    await expect(svc.notifyCapable({ title: "t", body: "b" })).resolves.toMatchObject({ sent: 0 });
  });

  it("survives one bad recipient without dropping the rest", async () => {
    const svc = withDb(async (sql, params) => {
      if (/SELECT DISTINCT/s.test(sql)) return { rows: [{ platform_user_id: "a" }, { platform_user_id: "b" }] };
      if (/SELECT 1 FROM platform\.notification/s.test(sql)) return { rows: [] };
      if (params[0] === "a") throw new Error("fk violation");
      return { rows: [{ id: "n-b" }] };
    }, NOTIF);

    expect(await svc.notifyCapable({ title: "t", body: "b" })).toMatchObject({ sent: 1, recipients: 2 });
  });
});

/**
 * These four are the behavioural half of a structural gap.
 *
 * platform-capability-coverage.test.js asserts that every authenticated route
 * on the platform router carries a capability gate. The notification READ
 * routes deliberately do not — a notification addressed to you is yours, and
 * gating it on `errors.read` would mean a PLATFORM_SUPPORT user can be sent
 * something they cannot open. They are listed there under SELF_SCOPED, and that
 * list points here.
 *
 * So this is where the authorisation is actually proven. A structural test
 * cannot see a WHERE clause; these assert that the clause is present and is
 * keyed on the CALLER, not on a parameter the caller controls.
 */
describe("notifications — authorisation is per row, not per role", () => {
  it("scopes the list to the caller", async () => {
    let sql = null;
    let params = null;
    const svc = withDb(async (q, p) => {
      sql = q;
      params = p;
      return { rows: [] };
    }, NOTIF);

    await svc.list("u-1", { status: "all", limit: 10 });

    expect(sql).toMatch(/n\.to_user_id = \$1/);
    expect(params[0]).toBe("u-1");
  });

  it("scopes the unread count to the caller", async () => {
    let sql = null;
    let params = null;
    const svc = withDb(async (q, p) => {
      sql = q;
      params = p;
      return { rows: [{ unread: 3 }] };
    }, NOTIF);

    expect(await svc.unreadCount("u-1")).toEqual({ unread: 3 });
    expect(sql).toMatch(/to_user_id = \$1/);
    expect(params).toEqual(["u-1"]);
  });

  it("scopes mark-all-read to the caller", async () => {
    let sql = null;
    let params = null;
    const svc = withDb(async (q, p) => {
      sql = q;
      params = p;
      return { rowCount: 2 };
    }, NOTIF);

    await svc.markAllRead("u-1");

    expect(sql).toMatch(/to_user_id = \$1/);
    expect(params).toEqual(["u-1"]);
  });

  it("cannot be widened by a caller-supplied filter", async () => {
    // The caller controls `status`, `limit` and `before`. None of them may
    // reach the recipient predicate — that is the whole basis for these routes
    // having no capability gate.
    let sql = null;
    const svc = withDb(async (q) => {
      sql = q;
      return { rows: [] };
    }, NOTIF);

    await svc.list("u-1", { status: "unread", limit: 999, before: "2026-08-01T00:00:00Z" });

    expect(sql).toMatch(/n\.to_user_id = \$1/);
    // Clamped, not honoured — LIMIT is the last parameter.
    expect(sql).toMatch(/LIMIT \$\d+/);
  });
});

describe("notifications — read state is per person", () => {
  it("scopes markRead by recipient, so a guessed uuid is a 404", async () => {
    let params = null;
    const svc = withDb(async (_sql, p) => {
      params = p;
      return { rows: [] }; // not yours
    }, NOTIF);

    await expect(svc.markRead("n-1", "someone-else")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The predicate is the authorisation check, not a filter.
    expect(params).toEqual(["n-1", "someone-else"]);
  });

  it("keeps the FIRST read time when marked twice", async () => {
    let sql = null;
    const svc = withDb(async (q) => {
      sql = q;
      return { rows: [{ id: "n-1", read_at: "2026-08-08T10:00:00Z" }] };
    }, NOTIF);

    await svc.markRead("n-1", "u-1");
    expect(sql).toMatch(/COALESCE\(read_at, now\(\)\)/);
  });

  it("purges read notifications only — unread survives any age", async () => {
    let sql = null;
    const svc = withDb(async (q) => {
      sql = q;
      return { rowCount: 3 };
    }, NOTIF);

    expect(await svc.purge({ days: 90 })).toEqual({ deleted: 3, days: 90 });
    expect(sql).toMatch(/read_at IS NOT NULL/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("uptime — the denominator is expected samples, not recorded ones", () => {
  const HOUR = 3_600_000;

  /** Six hours of history, `healthy` of which were good, at a 60s cadence. */
  const rows = ({ samples, healthy, hoursAgo = 6 }) => [
    {
      samples,
      healthy,
      degraded: 0,
      first_sample: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
      last_sample: new Date().toISOString(),
      avg_db_latency_ms: 4.2,
      p95_db_latency_ms: 9,
    },
  ];

  it("counts MISSING samples as downtime", async () => {
    // Six hours at 60s = 360 expected. The collector wrote 300 healthy rows and
    // nothing at all for the other hour, because the platform was down and the
    // worker was down with it. avg(healthy) would say 100%.
    process.env.HEALTH_SAMPLE_INTERVAL_MS = "60000";
    const svc = withDb(async () => ({ rows: rows({ samples: 300, healthy: 300 }) }), HEALTH);

    const out = await svc.uptime({ days: 30 });

    expect(out.expected_samples).toBeGreaterThan(350);
    expect(out.uptime_percent).toBeLessThan(90);
    expect(out.uptime_percent).toBeGreaterThan(80);
  });

  it("measures from the first sample, so a fresh install is not 0.14%", async () => {
    // Without this clamp, six hours of perfect samples over a 30-day window
    // reports 0.83% uptime — a number nobody would believe or act on.
    process.env.HEALTH_SAMPLE_INTERVAL_MS = "60000";
    const svc = withDb(async () => ({ rows: rows({ samples: 360, healthy: 360 }) }), HEALTH);

    const out = await svc.uptime({ days: 30 });

    expect(out.uptime_percent).toBeGreaterThan(95);
    expect(out.measured_from).not.toBeNull();
    // The caller needs this to say "over the last 6 hours" rather than "(30d)".
    expect(new Date(out.measured_from).getTime()).toBeGreaterThan(Date.now() - 7 * HOUR);
  });

  it("never reports above 100%", async () => {
    // Clock skew or a second worker produces more samples than expected. A
    // 100.3% uptime destroys confidence in the figure far more than the
    // fraction of a percent it is off by.
    process.env.HEALTH_SAMPLE_INTERVAL_MS = "60000";
    const svc = withDb(async () => ({ rows: rows({ samples: 900, healthy: 900, hoursAgo: 6 }) }), HEALTH);

    expect((await svc.uptime({ days: 30 })).uptime_percent).toBeLessThanOrEqual(100);
  });

  it("returns null rather than a fabricated figure when nothing was sampled", async () => {
    const svc = withDb(async () => ({ rows: [{ samples: 0 }] }), HEALTH);

    const out = await svc.uptime({});

    // 100% from zero evidence is the exact failure migration 0090 refused to
    // create a table for.
    expect(out.uptime_percent).toBeNull();
    expect(out.collector).toBe("no_samples");
  });
});

describe("health sampling — a failed probe is a data point, not an error", () => {
  it("records unhealthy when Postgres is down and does not throw", async () => {
    let inserted = null;
    const svc = withDb(async (sql, params) => {
      if (/INSERT INTO platform\.health_sample/s.test(sql)) {
        inserted = params;
        return { rows: [] };
      }
      throw new Error("ECONNREFUSED");
    }, HEALTH);

    const out = await svc.sample();

    expect(out.healthy).toBe(false);
    expect(out.status).toBe("unavailable");
    // The row is the whole point: an outage that writes nothing is invisible.
    expect(inserted && inserted[0]).toBe(false);
  });

  it("treats Redis down as degraded, not as downtime", async () => {
    // /health/ready returns 200 when only Redis is gone, because requests are
    // still served. Recording it as downtime would make the uptime figure
    // disagree with the load balancer, and then neither would be trusted.
    jest.resetModules();
    jest.doMock(DB, () => ({ query: async () => ({ rows: [{ "?column?": 1 }] }) }));
    jest.doMock("../../src/config/redis", () => ({
      getClient: () => ({ ping: async () => { throw new Error("redis down"); } }),
    }));

    const svc = require(HEALTH);

    const out = await svc.sample();

    expect(out.healthy).toBe(true);
    expect(out.status).toBe("degraded");
  });

  it("leaves latency NULL on a failed probe rather than recording 0", async () => {
    // A zero drags every average toward "fast" at precisely the moment things
    // are slow, which is when the number is read.
    const svc = withDb(async (sql) => {
      if (/INSERT INTO/s.test(sql)) return { rows: [] };
      throw new Error("down");
    }, HEALTH);

    expect((await svc.sample()).db_latency_ms).toBeNull();
  });
});
