"use strict";

/**
 * Calls audit B1, against a real schema: the liveness sweep ends an abandoned
 * call `disconnected`, a value the 14000 CHECK on comms_call.end_reason
 * refused. The UPDATE failed with 23514, the sweep threw every 15 s, and the
 * call stayed IN_CALL until the 30-minute cap. Migration 14040 drops the CHECK
 * and the repo holds the closed set instead.
 *
 * Redis (presence, an in-memory stand-in) and the queue are faked; the call row, the
 * transition and the event/audit writes are real. Everything runs in one
 * transaction that is rolled back.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant (search_path =
 * the tenant schema); self-skips otherwise, like every suite in this directory.
 */

jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
const mockRedis = require("../../src/config/redis").__fake;
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => null) }));
jest.mock("../../src/realtime", () => ({ publishToUser: jest.fn(), publish: jest.fn() }));

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("call liveness against the real schema (audit B1)", () => {
  let pool;
  let client;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
  });
  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  async function abandonedCall() {
    const users = await client.query(
      `INSERT INTO app_user (email, full_name, password_hash)
       VALUES ($1, 'Liveness Caller', 'x'), ($2, 'Liveness Callee', 'x')
       RETURNING user_id`,
      [`liveness-a-${Date.now()}@example.test`, `liveness-b-${Date.now()}@example.test`],
    );
    const [a, b] = users.rows.map((r) => r.user_id);
    const group = await client.query(
      "INSERT INTO comms_group (kind, name) VALUES ('DIRECT', 'liveness') RETURNING group_id",
    );
    const call = await client.query(
      `INSERT INTO comms_call (group_id, caller_id, callee_id, status, connected_at)
       VALUES ($1, $2, $3, 'IN_CALL', now() - interval '5 minutes')
       RETURNING call_id`,
      [group.rows[0].group_id, a, b],
    );
    // Both devices gone for longer than LIVENESS_OFFLINE_S (180 s, FN-2), and
    // neither beating that its media is up — the abandoned call this suite is
    // about. `mediaBeat` below is the same call with a live beat.
    const gone = String(Date.now() - 400_000);
    await mockRedis.set(`presence:off:citenant:live:${a}`, gone);
    await mockRedis.set(`presence:off:citenant:live:${b}`, gone);
    return { callId: call.rows[0].call_id, a, b };
  }

  const inRollback = async (fn) => {
    await client.query("BEGIN");
    try {
      return await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  };

  it("ends the abandoned call ENDED(disconnected)", async () => {
    const service = require("../../src/modules/smartcomm/smartcomm.call.service");
    await inRollback(async () => {
      const { callId } = await abandonedCall();
      const { moved } = await service.sweep(client, { tenantSlug: "citenant", env: "live" });
      expect(moved).toBeGreaterThanOrEqual(1);
      const { rows } = await client.query(
        "SELECT status, end_reason, duration_seconds FROM comms_call WHERE call_id = $1",
        [callId],
      );
      expect(rows[0]).toEqual(expect.objectContaining({ status: "ENDED", end_reason: "disconnected" }));
      expect(rows[0].duration_seconds).toBeGreaterThanOrEqual(299);
    });
  });

  /**
   * FN-2. The sweep reads SOCKET presence, and a socket is not the call: the
   * audio is peer-to-peer and this process never sees it. A browser whose
   * socket died over a live media path beats over HTTP instead, and that beat
   * has to outrank the sockets — otherwise the sweep ends a call that two
   * people are still talking on, which is what it did at 60 s.
   */
  it("does NOT end a call whose media is still beating, though both sockets are gone", async () => {
    const service = require("../../src/modules/smartcomm/smartcomm.call.service");
    await inRollback(async () => {
      const { callId, a } = await abandonedCall();
      // One side is enough: the audio has two ends, so either one reporting a
      // live path means the call is up.
      await mockRedis.set(`presence:media:citenant:live:${a}`, callId);
      await service.sweep(client, { tenantSlug: "citenant", env: "live" });
      const { rows } = await client.query("SELECT status FROM comms_call WHERE call_id = $1", [callId]);
      expect(rows[0].status).toBe("IN_CALL");
    });
  });

  it("ends it once the beat is for a DIFFERENT call (a leftover must not keep it alive)", async () => {
    const service = require("../../src/modules/smartcomm/smartcomm.call.service");
    await inRollback(async () => {
      const { callId, a } = await abandonedCall();
      await mockRedis.set(`presence:media:citenant:live:${a}`, "00000000-0000-0000-0000-000000000000");
      await service.sweep(client, { tenantSlug: "citenant", env: "live" });
      const { rows } = await client.query(
        "SELECT status, end_reason FROM comms_call WHERE call_id = $1", [callId],
      );
      expect(rows[0]).toEqual(expect.objectContaining({ status: "ENDED", end_reason: "disconnected" }));
    });
  });

  it("control: with the 14000 CHECK back, the same sweep fails with 23514 (what production does today)", async () => {
    const service = require("../../src/modules/smartcomm/smartcomm.call.service");
    await inRollback(async () => {
      await client.query(
        `ALTER TABLE comms_call ADD CONSTRAINT liveness_probe_old_check
           CHECK (end_reason IS NULL OR end_reason IN
             ('hangup','declined','cancelled','no_answer','busy','max_duration','ice_failed'))`,
      );
      await abandonedCall();
      await expect(service.sweep(client, { tenantSlug: "citenant", env: "live" }))
        .rejects.toMatchObject({ code: "23514" });
    });
  });
});
