"use strict";

/**
 * Calls audit PR-3, against a real schema (live AND sandbox): the SQL the unit
 * tests can only describe.
 *
 *   C6  directPartner reads the callee's status from live.app_user, because
 *       sandbox.app_user is a mirror whose status is never updated: a user
 *       suspended in live still reads ACTIVE there.
 *   C6  a deactivated user's push subscriptions go from both schemas.
 *   C2  ensureTurnToken writes a token only for a live call and never
 *       replaces one; C5 liveCounterpart answers only for a live call.
 *
 * One transaction, rolled back. Runs only with DATABASE_URL pointing at a
 * provisioned tenant; self-skips otherwise, like every suite in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("PR-3 hardening against the real schema", () => {
  let pool;
  let client;
  const repo = require("../../src/modules/smartcomm/smartcomm.call.repo");
  const dropPush = require("../../src/orchestration/handlers/user-deactivated-drop-push");

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("BEGIN");
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
        `INSERT INTO live.app_user (email, full_name, password_hash) VALUES ($1, $2, 'x') RETURNING user_id`,
        [`${prefix}-${i}-${stamp}@example.test`, `${prefix} ${i}`],
      );
      out.push(rows[0].user_id);
    }
    return out;
  }
  // What shared/db/sandbox-user-mirror.js does: copy once, never update.
  const mirror = (ids) => client.query(
    `INSERT INTO sandbox.app_user (user_id, username, email, full_name, password_hash, is_2fa_enabled, status, created_at, updated_at)
     SELECT user_id, username, email, full_name, password_hash, is_2fa_enabled, status, created_at, updated_at
       FROM live.app_user WHERE user_id = ANY($1::uuid[]) ON CONFLICT DO NOTHING`,
    [ids],
  );
  const inSchema = (schema) => client.query(`SET LOCAL search_path = ${schema}, public`);

  test("C6: a callee suspended in live is not rung in sandbox, whatever the mirror says", async () => {
    const [caller, callee] = await users(2, "c6-sandbox");
    await mirror([caller, callee]);
    await client.query("UPDATE live.app_user SET status = 'SUSPENDED' WHERE user_id = $1", [callee]);
    const { rows: [stale] } = await client.query("SELECT status FROM sandbox.app_user WHERE user_id = $1", [callee]);
    expect(stale.status).toBe("ACTIVE"); // the mirror really is stale

    await inSchema("sandbox");
    const { rows: [g] } = await client.query("INSERT INTO comms_group (kind, name) VALUES ('DIRECT', 'c6') RETURNING group_id");
    await client.query("INSERT INTO comms_member (group_id, user_id) VALUES ($1, $2), ($1, $3)", [g.group_id, caller, callee]);
    expect(await repo.directPartner(client, { groupId: g.group_id, userId: caller })).toBeNull();
    expect(await repo.isDirectChannel(client, g.group_id)).toBe(true);

    await client.query("UPDATE live.app_user SET status = 'ACTIVE' WHERE user_id = $1", [callee]);
    expect(await repo.directPartner(client, { groupId: g.group_id, userId: caller })).toEqual({ user_id: callee });
    await inSchema("live");
  });

  test("C6: deactivation removes the user's devices from live and sandbox", async () => {
    const [u, other] = await users(2, "c6-push");
    await mirror([u, other]);
    const sub = (schema, user, n) => client.query(
      `INSERT INTO ${schema}.push_subscription (user_id, endpoint, p256dh, auth) VALUES ($1, $2, 'k', 'a')`,
      [user, `https://push.example.test/${schema}/${n}-${stamp}`],
    );
    await sub("live", u, 1);
    await sub("live", u, 2);
    await sub("sandbox", u, 3);
    await sub("live", other, 4);
    await client.query("UPDATE live.app_user SET status = 'SUSPENDED' WHERE user_id = $1", [u]);

    await inSchema("live");
    expect(await dropPush.run(client, { entity_ref: `app_user:${u}` })).toEqual({ deleted: 3 });
    const count = async (schema, user) => Number((await client.query(
      `SELECT count(*) AS n FROM ${schema}.push_subscription WHERE user_id = $1`, [user],
    )).rows[0].n);
    expect(await count("live", u)).toBe(0);
    expect(await count("sandbox", u)).toBe(0);
    expect(await count("live", other)).toBe(1);
  });

  test("C2 and C5: the token and the counterpart exist only for a live call", async () => {
    await inSchema("live");
    const [a, b, stranger] = await users(3, "c2");
    const { rows: [g] } = await client.query("INSERT INTO comms_group (kind, name) VALUES ('DIRECT', 'c2') RETURNING group_id");
    const { call } = await repo.insertCall(client, { groupId: g.group_id, callerId: a, calleeId: b, turnToken: "tok-at-dial" });
    expect(call.turn_token).toBe("tok-at-dial");

    // Never replaced once written.
    expect(await repo.ensureTurnToken(client, { callId: call.call_id, token: "other" })).toBe("tok-at-dial");
    expect(await repo.liveCounterpart(client, { callId: call.call_id, userId: a })).toEqual({ user_id: b });
    expect(await repo.liveCounterpart(client, { callId: call.call_id, userId: stranger })).toBeNull();

    await repo.transition(client, { callId: call.call_id, fromStatus: "RINGING", status: "DECLINED", fields: { end_reason: "declined" } });
    expect(await repo.liveCounterpart(client, { callId: call.call_id, userId: a })).toBeNull();

    // A call dialled before 14060 (no token) gets none once it has ended.
    await client.query("UPDATE comms_call SET turn_token = NULL WHERE call_id = $1", [call.call_id]);
    expect(await repo.ensureTurnToken(client, { callId: call.call_id, token: "late" })).toBeNull();
  });
});
