"use strict";

/**
 * The sandbox app_user mirror kept a user's FIRST status forever
 * (`ON CONFLICT DO NOTHING`), so sandbox saw a suspended user as ACTIVE
 * (calls audit PR-3 new finding, fixed in PR-5). Real schema: live and
 * sandbox, one transaction, rolled back.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise, like every suite in this directory.
 */

jest.mock("../../src/shared/cache/identity-cache", () => ({ invalidateUser: jest.fn(async () => undefined) }));

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("sandbox app_user keeps the live status (real schema)", () => {
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

  async function liveUser() {
    const { rows } = await client.query(
      `INSERT INTO live.app_user (email, full_name, password_hash, status)
       VALUES ($1, 'Mirror Person', 'x', 'ACTIVE') RETURNING user_id`,
      [`mirror-${Date.now()}-${Math.random()}@example.test`],
    );
    return rows[0].user_id;
  }
  const sandboxStatus = async (id) =>
    (await client.query("SELECT status FROM sandbox.app_user WHERE user_id = $1", [id])).rows[0]?.status;

  it("a user suspended after the first mirror is SUSPENDED in sandbox too", async () => {
    const { mirrorUsersIntoSandbox } = require("../../src/shared/db/sandbox-user-mirror");
    const id = await liveUser();
    await mirrorUsersIntoSandbox(client, { userId: id });
    expect(await sandboxStatus(id)).toBe("ACTIVE");

    // Through the real service, the way an admin suspends someone. It opens
    // no transaction of its own, so this test's rollback still holds.
    const service = require("../../src/modules/security/app_user/app_user.service");
    await client.query("SET LOCAL search_path = live, public");
    await service.setStatus(client, { id, status: "SUSPENDED", actor: {} });
    expect(await sandboxStatus(id)).toBe("SUSPENDED");
  });

  it("the whole-tenant mirror (backfill, wipe) also brings statuses back in step", async () => {
    const { mirrorUsersIntoSandbox } = require("../../src/shared/db/sandbox-user-mirror");
    const id = await liveUser();
    await mirrorUsersIntoSandbox(client, { userId: id });
    await client.query("UPDATE live.app_user SET status = 'LOCKED' WHERE user_id = $1", [id]);
    await mirrorUsersIntoSandbox(client);
    expect(await sandboxStatus(id)).toBe("LOCKED");
  });
});
