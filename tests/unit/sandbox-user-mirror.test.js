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
function fakeClient({
  sandboxReady = true,
  present = true,
  rowCount = 1,
} = {}) {
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

describe("keeping an already-mirrored user in step (calls audit PR-5)", () => {
  beforeEach(() => logger.warn.mockClear());

  it("copies status (and the display fields) onto a sandbox row that already exists", async () => {
    const c = fakeClient({ rowCount: 0 });
    await mirrorUsersIntoSandbox(c, { userId: USER });
    const sync = c.queries.find((q) => /^UPDATE sandbox\.app_user/.test(q.sql));
    expect(sync).toBeDefined();
    expect(sync.sql).toContain("FROM live.app_user");
    expect(sync.sql).toMatch(/status\s*=\s*l\.status/);
    expect(sync.sql).toContain("s.user_id = l.user_id");
    expect(sync.params).toEqual([USER]);
  });

  it("syncs every user when no id is given", async () => {
    const c = fakeClient({ rowCount: 0 });
    await mirrorUsersIntoSandbox(c);
    const sync = c.queries.find((q) => /^UPDATE sandbox\.app_user/.test(q.sql));
    expect(sync.params).toEqual([]);
    expect(sync.sql).not.toContain("$1");
  });

  it("never syncs email, username or a secret (a unique clash must not fail the mirror)", async () => {
    const c = fakeClient();
    await mirrorUsersIntoSandbox(c, { userId: USER });
    const sync = c.queries.find((q) => /^UPDATE sandbox\.app_user/.test(q.sql));
    const setClause = sync.sql.split(/\bFROM\b/)[0];
    expect(setClause).not.toMatch(/email|username|password_hash|totp|godmode/);
  });
});

describe("app_user.setStatus mirrors the new status into sandbox", () => {
  it("calls the mirror after the status changes", async () => {
    jest.resetModules();
    const mirror = jest.fn(async () => undefined);
    jest.doMock("../../src/shared/db/sandbox-user-mirror", () => ({ mirrorUserBestEffort: mirror }));
    jest.doMock("../../src/modules/security/app_user/app_user.repo", () => ({
      getUserSafe: jest.fn(async () => ({ user_id: USER, status: "ACTIVE" })),
      roleCodes: jest.fn(async () => []),
      setStatus: jest.fn(async () => ({ user_id: USER, status: "SUSPENDED" })),
    }));
    jest.doMock("../../src/shared/cache/identity-cache", () => ({ invalidateUser: jest.fn(async () => undefined) }));
    jest.doMock("../../src/shared/events/emit", () => ({
      emitEvent: jest.fn(async () => undefined),
      audit: jest.fn(async () => undefined),
      resolveActorId: jest.fn(async (_c, id) => id),
    }));
    const service = require("../../src/modules/security/app_user/app_user.service");
    await service.setStatus({ query: jest.fn() }, { id: USER, status: "SUSPENDED", actor: {} });
    expect(mirror).toHaveBeenCalledWith(expect.anything(), USER);
  });
});
