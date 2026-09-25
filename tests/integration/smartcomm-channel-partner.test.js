"use strict";
/**
 * Calls audit D9, on the real schema: the channel list's DIRECT partner is
 * one lateral join (it was three correlated subqueries per row), and it
 * returns the same three things: the partner's id, avatar and last seen, and
 * nothing for a group channel. One transaction, rolled back.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise, like every suite in this directory.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("channel list partner (real schema, audit D9)", () => {
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
  beforeEach(() => client.query("BEGIN"));
  afterEach(() => client.query("ROLLBACK"));

  test("DIRECT rows carry the partner; group rows carry none", async () => {
    const tag = `${Date.now()}-${Math.random()}`;
    const users = await client.query(
      `INSERT INTO app_user (email, full_name, password_hash, avatar_ref)
       VALUES ($1, 'Me', 'x', NULL), ($2, 'Partner', 'x', 'avatars/p.webp'), ($3, 'Third', 'x', NULL)
       RETURNING user_id`,
      [`me-${tag}@example.test`, `p-${tag}@example.test`, `t-${tag}@example.test`],
    );
    const [me, partner, third] = users.rows.map((r) => r.user_id);
    const dm = (await client.query("INSERT INTO comms_group (kind, name) VALUES ('DIRECT', 'dm') RETURNING group_id")).rows[0].group_id;
    const grp = (await client.query("INSERT INTO comms_group (kind, name) VALUES ('PROJECT', 'team') RETURNING group_id")).rows[0].group_id;
    for (const [g, u] of [[dm, me], [dm, partner], [grp, me], [grp, partner], [grp, third]]) {
      await client.query("INSERT INTO comms_member (group_id, user_id) VALUES ($1, $2)", [g, u]);
    }
    await client.query("INSERT INTO comms_user_presence (user_id, last_seen_at) VALUES ($1, now() - interval '5 minutes')", [partner]);

    const repo = require("../../src/modules/smartcomm/smartcomm.repo");
    const rows = await repo.listChannelsForUser(client, me, {});
    const byId = new Map(rows.map((r) => [r.group_id, r]));
    expect(byId.get(dm)).toEqual(expect.objectContaining({ partner_user_id: partner, partner_avatar_ref: "avatars/p.webp" }));
    expect(byId.get(dm).partner_last_seen_at).toBeTruthy();
    expect(byId.get(grp)).toEqual(expect.objectContaining({ partner_user_id: null, partner_avatar_ref: null, partner_last_seen_at: null }));

    // PR-6 (audit G4): the partner hides their last seen.
    await client.query(
      `INSERT INTO live.user_preference (user_id, section, key, value) VALUES ($1, 'calls', 'hide_last_seen', 'true'::jsonb)
       ON CONFLICT (user_id, section, key) DO UPDATE SET value = EXCLUDED.value`,
      [partner],
    );
    const hidden = (await repo.listChannelsForUser(client, me, {})).find((r) => r.group_id === dm);
    expect(hidden.partner_last_seen_at).toBeNull();
    expect(hidden.partner_user_id).toBe(partner);
    const colleagues = await repo.listColleagues(client, { limit: 500 });
    expect(colleagues.find((u) => u.user_id === partner).last_seen_at).toBeNull();

    const plan = await client.query(
      `EXPLAIN SELECT 1 FROM comms_group g JOIN comms_member m ON m.group_id = g.group_id AND m.user_id = $1
       LEFT JOIN LATERAL (SELECT u.user_id FROM comms_member pm JOIN app_user u ON u.user_id = pm.user_id
       WHERE g.kind = 'DIRECT' AND pm.group_id = g.group_id AND pm.user_id <> $1 LIMIT 1) partner ON true`,
      [me],
    );
    expect(plan.rows.length).toBeGreaterThan(0);
  });
});
