"use strict";

/**
 * Calls audit PR-4, against a real schema: the SQL behind rings on every
 * device, which the unit tests can only describe.
 *
 *   A14  claimRingAlert: each ring push is claimed on comms_call.ring_alerts
 *        before it is sent (exactly one claim per alert number, only while
 *        the call rings), and the first stamps ring_push_sent_at.
 *   A13  listRingingForUser: the calls ringing for me, within the window,
 *        with the seconds left by the database clock and the caller's name.
 *   E5   14070 left the noise default off.
 *
 * One transaction, rolled back. Runs only with DATABASE_URL pointing at a
 * provisioned tenant; self-skips otherwise, like every suite in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("PR-4 rings against the real schema", () => {
  let pool;
  let client;
  const repo = require("../../src/modules/smartcomm/smartcomm.call.repo");

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = live, public");
  });
  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    if (pool) await pool.end();
  });

  const stamp = `${Date.now()}-${process.pid}`;
  async function users(n, prefix) {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const { rows } = await client.query(
        "INSERT INTO app_user (email, full_name, password_hash) VALUES ($1, $2, 'x') RETURNING user_id",
        [`${prefix}-${i}-${stamp}@example.test`, `${prefix} ${i}`],
      );
      out.push(rows[0].user_id);
    }
    return out;
  }
  async function call(callerId, calleeId, name) {
    const { rows: [g] } = await client.query("INSERT INTO comms_group (kind, name) VALUES ('DIRECT', $1) RETURNING group_id", [name]);
    const { call: row } = await repo.insertCall(client, { groupId: g.group_id, callerId, calleeId, turnToken: `tok-${name}` });
    return row;
  }

  test("A14: one claim per alert, in order, only while the call rings", async () => {
    const [a, b] = await users(2, "ring-claim");
    const c = await call(a, b, "claim");
    expect(c.ring_alerts).toBeNull();

    const first = await repo.claimRingAlert(client, { callId: c.call_id, alert: 0 });
    expect(first.ring_alerts).toBe(1);
    expect(first.ring_push_sent_at).toBeTruthy();
    // The same alert again (a queue retry): no claim.
    expect(await repo.claimRingAlert(client, { callId: c.call_id, alert: 0 })).toBeNull();
    // An alert out of order: no claim.
    expect(await repo.claimRingAlert(client, { callId: c.call_id, alert: 2 })).toBeNull();

    const second = await repo.claimRingAlert(client, { callId: c.call_id, alert: 1 });
    expect(second.ring_alerts).toBe(2);
    // The first push's time is kept.
    expect(new Date(second.ring_push_sent_at).getTime()).toBe(new Date(first.ring_push_sent_at).getTime());

    await repo.transition(client, { callId: c.call_id, fromStatus: "RINGING", status: "IN_CALL", fields: { connected_at: new Date().toISOString() } });
    expect(await repo.claimRingAlert(client, { callId: c.call_id, alert: 2 })).toBeNull();
  });

  test("A13: the ringing read lists my ringing calls, with the seconds left and the caller's name", async () => {
    const [caller, me, other] = await users(3, "ring-read");
    const mine = await call(caller, me, "read-mine");
    // A ring 50 s old: 10 s left.
    await client.query("UPDATE comms_call SET started_at = now() - interval '50 seconds' WHERE call_id = $1", [mine.call_id]);

    const rows = await repo.listRingingForUser(client, { userId: me, windowS: 60 });
    expect(rows.map((r) => r.call_id)).toEqual([mine.call_id]);
    expect(rows[0].caller_name).toBe("ring-read 0");
    expect(rows[0].ring_seconds_left).toBeGreaterThanOrEqual(9);
    expect(rows[0].ring_seconds_left).toBeLessThanOrEqual(10);

    // Not the caller's list, not a stranger's.
    expect(await repo.listRingingForUser(client, { userId: caller, windowS: 60 })).toEqual([]);
    expect(await repo.listRingingForUser(client, { userId: other, windowS: 60 })).toEqual([]);

    // Past the window (the sweep has not run yet): not listed.
    await client.query("UPDATE comms_call SET started_at = now() - interval '61 seconds' WHERE call_id = $1", [mine.call_id]);
    expect(await repo.listRingingForUser(client, { userId: me, windowS: 60 })).toEqual([]);

    // Answered: not listed.
    await client.query("UPDATE comms_call SET started_at = now() WHERE call_id = $1", [mine.call_id]);
    await repo.transition(client, { callId: mine.call_id, fromStatus: "RINGING", status: "IN_CALL", fields: { connected_at: new Date().toISOString() } });
    expect(await repo.listRingingForUser(client, { userId: me, windowS: 60 })).toEqual([]);
  });

  test("E5: the noise filter's default is off after 14070", async () => {
    const { rows } = await client.query(
      "SELECT value FROM setting WHERE section = 'comms' AND key = 'call_noise_suppression'",
    );
    expect(rows[0].value).toEqual({ enabled: false });
  });
});
