"use strict";

/**
 * Regression — silent token refresh writes nothing to `event_log` OR to
 * `immutable_ledger`.
 *
 * WHY THIS EXISTS. The auth service used to `emitEvent({ eventTypeKey:
 * TOKEN_REFRESHED })` on every refresh. Silent refresh fires every ~15 min on
 * every active tab, so a typical user's self-scoped audit feed was almost
 * entirely "Auth token refreshed · App user c2d39ee8" — the surface defect the
 * new `/audit/my-feed` Control Tower widget was built to solve. Removing the
 * emit was one line, and putting it back would be one line too — this test
 * fails on either regression path:
 *
 *   - a straight re-add of `emitEvent({ eventTypeKey: events.TOKEN_REFRESHED })`
 *   - or a well-meaning `audit({ action: "auth.token_refreshed" })` in its place
 *
 * The mocking pattern mirrors `tests/unit/auth-refresh-flow.test.js` — mock
 * the repo, cache, session store and the event/audit module, run the real
 * refresh() end to end (JWT + rotation logic exercised), assert that neither
 * side observed a refresh-typed row. The task brief phrased the check against
 * `event_log` and `immutable_ledger` directly; those are the two tables
 * `emitEvent` and `audit` write to respectively, so intercepting the two
 * helpers is exactly the same signal without needing a live database.
 */

const jwt = require("jsonwebtoken");

let mockSession = null;
const mockCalls = { events: [], audits: [] };

jest.mock("../../src/modules/security/app_user/app_user.repo", () => ({
  getActiveSession: async () => mockSession,
  killSession: async () => {},
  touchSession: async () => {},
  setRefreshJti: async (_c, sid, jti) => { if (mockSession) mockSession.refresh_jti = jti; },
  roleNames: async () => [],
}));

jest.mock("../../src/shared/cache/session-store", () => ({
  indexSession: async () => {},
  listActiveSessionIds: async () => [],
  removeSession: async () => {},
}));

jest.mock("../../src/shared/cache/identity-cache", () => ({
  invalidateUser: async () => {},
  invalidateGrants: async () => {},
  getAuthUser: async () => null,
  getGrants: async () => [],
}));

// Intercept both writers. `event_log` is emitEvent's target; `immutable_ledger`
// is audit's. If refresh() calls either with a refresh-typed key, this test
// picks it up before the request leaves the process.
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (_c, e) => { mockCalls.events.push(e); },
  audit: async (_c, a) => { mockCalls.audits.push(a); },
  withActor: () => ({}),
  resolveActorId: async () => null,
  clearEventTypeCache: () => {},
  WATCHER_ROLE_CODES: [],
}));

const { config } = require("../../src/config/env");
const svc = require("../../src/modules/security/app_user/app_user.service");

const client = { query() { throw new Error("refresh() went to the DB — every read must be mocked"); } };

const USER = "user-1";
const SID = "session-1";

function makeRefreshToken({ jti = "jti-1" } = {}) {
  return jwt.sign(
    { sub: USER, sid: SID, jti, typ: "refresh" },
    config.JWT_REFRESH_SECRET,
    { expiresIn: "30d" },
  );
}

function liveSession() {
  return {
    session_id: SID,
    user_id: USER,
    killed_at: null,
    last_seen_at: new Date().toISOString(),
    refresh_jti: "jti-1",
    keep_signed_in: false,
    idle_seconds: 10,
  };
}

describe("silent token refresh is not audited (Control Tower feed noise)", () => {
  beforeEach(() => {
    mockSession = liveSession();
    mockCalls.events.length = 0;
    mockCalls.audits.length = 0;
  });

  it("emits zero rows into event_log for auth.token_refreshed", async () => {
    const out = await svc.refresh(client, { refreshToken: makeRefreshToken() });
    // Sanity: the refresh itself succeeded, so we know we tested the real path
    // rather than an early exit before any emit would have run.
    expect(out.access_token).toBeTruthy();
    expect(out.refresh_token).toBeTruthy();

    const refreshEvents = mockCalls.events.filter(
      (e) => e.eventTypeKey === "auth.token_refreshed",
    );
    expect(refreshEvents).toHaveLength(0);
  });

  it("appends zero rows to immutable_ledger for action=auth.token_refreshed", async () => {
    await svc.refresh(client, { refreshToken: makeRefreshToken() });
    const refreshAudits = mockCalls.audits.filter(
      (a) => a.action === "auth.token_refreshed",
    );
    expect(refreshAudits).toHaveLength(0);
  });

  it("stays quiet across three consecutive refreshes", async () => {
    // The everyday case a busy tab produces: refresh once, follow the rotation,
    // refresh again, and so on. If someone re-adds the emit at any hop this
    // fails with a specific count.
    let token = makeRefreshToken();
    for (let i = 0; i < 3; i += 1) {
      const out = await svc.refresh(client, { refreshToken: token });
      token = out.refresh_token;
    }
    expect(mockCalls.events.filter((e) => e.eventTypeKey === "auth.token_refreshed")).toHaveLength(0);
    expect(mockCalls.audits.filter((a) => a.action === "auth.token_refreshed")).toHaveLength(0);
  });
});
