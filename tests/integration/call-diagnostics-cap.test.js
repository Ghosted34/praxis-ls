"use strict";

/**
 * Test calls' daily cap against a real schema (calls audit PR-7, O5): three
 * runs a tenant a day, and SIX simultaneous starts on six connections still
 * make exactly three runs — the count and the insert are serialised by the
 * cap's advisory lock, so no two starts can both be the third.
 *
 * Commits (the race needs separate transactions), so it removes today's runs
 * before and after. Runs only with DATABASE_URL pointing at a provisioned
 * tenant; self-skips otherwise, like every suite in this directory.
 */

jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn(async () => ({})),
  getQueue: () => ({ getRepeatableJobs: async () => [{ key: "k", pattern: "0 10 * * *", tz: "Africa/Douala", next: Date.now() + 3600e3 }] }),
}));
jest.mock("../../src/realtime", () => ({ publishToUser: jest.fn() }));

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Test calls: the 3-a-day cap under a race", () => {
  let pool;
  let userId;
  const diag = require("../../src/modules/smartcomm/smartcomm.diagnostics.service");
  const clear = () => pool.query(
    `DELETE FROM comms_call_diagnostic_run WHERE started_at >= now() - interval '2 days'`,
  );

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const { rows } = await pool.query(
      `INSERT INTO app_user (email, full_name, password_hash) VALUES ($1, 'Diag runner', 'x') RETURNING user_id`,
      [`diag-${Date.now()}-${process.pid}@example.test`],
    );
    userId = rows[0].user_id;
    await clear();
  });
  afterAll(async () => {
    if (!pool) return;
    await clear();
    await pool.query("DELETE FROM app_user WHERE user_id = $1", [userId]);
    await pool.end();
  });

  test("six simultaneous starts make exactly three runs; the rest get 429 with the next available time", async () => {
    const start = async () => {
      const c = await pool.connect();
      try {
        return await diag.startRun(c, c, { actor: { user_id: userId }, env: "live", tenantMeta: { slug: "citenant" } });
      } finally {
        c.release();
      }
    };
    const results = await Promise.allSettled(Array.from({ length: 6 }, start));
    const made = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(made).toHaveLength(3);
    expect(refused).toHaveLength(3);
    for (const r of refused) {
      expect(r.reason).toMatchObject({ status: 429, code: "DIAGNOSTICS_DAILY_CAP" });
      expect(new Date(r.reason.details.next_available_at).getTime()).toBeGreaterThan(Date.now());
    }
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM comms_call_diagnostic_run WHERE user_id = $1", [userId],
    );
    expect(rows[0].n).toBe(3);
    // Each saved run has its schedules step and a worker step on its way.
    expect(made.every((r) => r.value.steps.find((s) => s.key === "schedules").status !== "pending")).toBe(true);
  });

  test("runs older than 90 days are removed when a run starts", async () => {
    await clear();
    await pool.query(
      `INSERT INTO comms_call_diagnostic_run (user_id, env, started_at, status) VALUES ($1, 'live', now() - interval '91 days', 'PASSED')`,
      [userId],
    );
    const c = await pool.connect();
    try {
      await diag.startRun(c, c, { actor: { user_id: userId }, env: "live", tenantMeta: { slug: "citenant" } });
    } finally {
      c.release();
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM comms_call_diagnostic_run WHERE user_id = $1 AND started_at < now() - interval '90 days'`,
      [userId],
    );
    expect(rows[0].n).toBe(0);
  });
});
