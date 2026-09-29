/**
 * The people backfill — shared/db/sandbox-live-copy.js. The copying itself is
 * SQL (migration 14250, exercised against a real Postgres in
 * tests/integration/sandbox-follows-live.test.js); this pins the JS wrapper that
 * the sandbox wipe, every deploy and scripts/tenant/mirror-users.js call.
 */
"use strict";

const { copyLivePeopleIntoSandbox } = require("../../src/shared/db/sandbox-live-copy");

function fakeClient({ migrated = true, counts = { entities: 2, employees: 5, accounts: 3 }, fail = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (fail) throw fail;
      if (/to_regprocedure/.test(sql)) return { rows: [{ ok: migrated }] };
      if (/sandbox_backfill_from_live/.test(sql)) return { rows: [counts] };
      return { rows: [] };
    },
  };
}

describe("copyLivePeopleIntoSandbox", () => {
  test("runs the LIVE copy of the backfill and reports what it wrote", async () => {
    const c = fakeClient();
    expect(await copyLivePeopleIntoSandbox(c)).toEqual({ entities: 2, employees: 5, accounts: 3 });
    // Schema-qualified: the caller's search_path may be either schema (the
    // wipe runs with it on sandbox), and the function exists in both.
    expect(c.queries.some((q) => /FROM live\.sandbox_backfill_from_live\(\)/.test(q))).toBe(true);
  });

  test("does nothing on a database 14250 has not reached yet", async () => {
    const c = fakeClient({ migrated: false });
    expect(await copyLivePeopleIntoSandbox(c)).toEqual({
      entities: 0, employees: 0, accounts: 0, skipped: "not-migrated",
    });
    expect(c.queries.some((q) => /sandbox_backfill_from_live\(\)$/.test(q))).toBe(false);
  });

  test("never writes to the live schema — the only statement is the sandbox backfill", async () => {
    const c = fakeClient();
    await copyLivePeopleIntoSandbox(c);
    for (const q of c.queries) expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  test("throws on a connection failure, like any query", async () => {
    await expect(copyLivePeopleIntoSandbox(fakeClient({ fail: new Error("gone") }))).rejects.toThrow("gone");
  });
});
