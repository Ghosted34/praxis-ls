/**
 * sandbox.app_user mirroring.
 *
 * Regression guard for the TEST-mode write failure: identity is pinned to the
 * LIVE schema while business data writes to the env-selected one, and 60+ tenant
 * columns are `REFERENCES app_user(user_id)` — so a user absent from
 * `sandbox.app_user` makes that user's TEST writes fail with 23503, usually after
 * the business row has already committed.
 *
 * The cases that matter: schemas must be named EXPLICITLY (callers arrive with
 * search_path set to whichever schema they were working in), the conflict clause
 * must carry no target (it has to absorb an email clash as well as a user_id one),
 * and the request-path wrapper must never throw.
 */
"use strict";

const {
  mirrorUsersIntoSandbox,
  mirrorUserBestEffort,
} = require("../../src/shared/db/sandbox-user-mirror");

jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
const { logger } = require("../../src/config/logger");

const USER = "3f1c9a10-0000-4000-8000-000000000001";

/**
 * Minimal fake pg client. `present` decides whether the verification SELECT finds
 * the mirrored row, which is how an email collision is simulated.
 */
function fakeClient({ sandboxReady = true, present = true, rowCount = 1 } = {}) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("to_regclass")) return { rows: [{ ok: sandboxReady }] };
      if (sql.startsWith("INSERT")) return { rowCount };
      return { rows: present ? [{ "?column?": 1 }] : [] };
    }),
  };
}

describe("mirrorUsersIntoSandbox", () => {
  beforeEach(() => logger.warn.mockClear());

  it("is a no-op when the sandbox schema is not there (mid-wipe, or unmigrated)", async () => {
    const c = fakeClient({ sandboxReady: false });
    const res = await mirrorUsersIntoSandbox(c);
    expect(res).toEqual({ mirrored: 0, skipped: "no-sandbox" });
    expect(c.queries.some((q) => q.sql.startsWith("INSERT"))).toBe(false);
  });

  it("names both schemas explicitly rather than trusting search_path", async () => {
    const c = fakeClient();
    await mirrorUsersIntoSandbox(c);
    const insert = c.queries.find((q) => q.sql.startsWith("INSERT"));
    expect(insert.sql).toContain("INSERT INTO sandbox.app_user");
    expect(insert.sql).toContain("FROM live.app_user");
  });

  it("never copies employee_id or a secret", async () => {
    const c = fakeClient();
    await mirrorUsersIntoSandbox(c);
    const insert = c.queries.find((q) => q.sql.startsWith("INSERT"));
    expect(insert.sql).not.toContain("employee_id");
    expect(insert.sql).not.toContain("totp_secret_enc");
    expect(insert.sql).not.toContain("godmode_pin_hash");
  });

  it("uses an untargeted ON CONFLICT so an email clash cannot raise", async () => {
    const c = fakeClient();
    await mirrorUsersIntoSandbox(c);
    const insert = c.queries.find((q) => q.sql.startsWith("INSERT"));
    expect(insert.sql).toContain("ON CONFLICT DO NOTHING");
    expect(insert.sql).not.toMatch(/ON CONFLICT\s*\(/);
  });

  it("filters to one user when given a userId, and all of them when not", async () => {
    const one = fakeClient();
    await mirrorUsersIntoSandbox(one, { userId: USER });
    const oneInsert = one.queries.find((q) => q.sql.startsWith("INSERT"));
    expect(oneInsert.sql).toContain("WHERE user_id = $1");
    expect(oneInsert.params).toEqual([USER]);

    const all = fakeClient();
    await mirrorUsersIntoSandbox(all);
    const allInsert = all.queries.find((q) => q.sql.startsWith("INSERT"));
    expect(allInsert.sql).not.toContain("WHERE user_id");
    expect(allInsert.params).toEqual([]);
  });

  it("warns when the user is still absent afterwards — the FK is unsatisfied", async () => {
    const c = fakeClient({ present: false, rowCount: 0 });
    await mirrorUsersIntoSandbox(c, { userId: USER });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("stays quiet on the happy path", async () => {
    await mirrorUsersIntoSandbox(fakeClient(), { userId: USER });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("mirrorUserBestEffort", () => {
  beforeEach(() => logger.warn.mockClear());

  it("swallows a database error — a live user create must not fail over sandbox", async () => {
    const c = {
      query: jest.fn(async () => {
        throw new Error("permission denied for schema sandbox");
      }),
    };
    await expect(mirrorUserBestEffort(c, USER)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does nothing without a user id", async () => {
    const c = fakeClient();
    await mirrorUserBestEffort(c, null);
    expect(c.query).not.toHaveBeenCalled();
  });
});
