"use strict";
/**
 * SEC-M1 — an access token whose session has been revoked must stop working.
 *
 * SEC-C2 put `sid` in the access token so logout could revoke the session
 * without the client naming it. Nothing then CHECKED it: killing a session,
 * hitting the idle timeout or tripping refresh-reuse detection blocked the next
 * REFRESH and left the already-issued access token working for the rest of its
 * TTL. "Revoke this session now" did not mean now — which is what the security
 * screen implies, and what an incident responder would be relying on while
 * containing a compromised account.
 *
 * WHAT MAKES THIS WORTH SIX TESTS RATHER THAN ONE. The naive fix — "reject if
 * the session is not in Redis" — is worse than the bug. Redis is a cache;
 * `user_session.killed_at` is the record. A restart, an eviction or a FLUSHDB
 * empties the index while every session in it is still valid, so a fail-closed
 * check would sign out every user of every tenant the first time Redis blinked.
 * The three-valued `isSessionActive` (true / false / null) exists precisely so
 * "absent" means "go and ask Postgres" and only "unreachable" means "assume
 * nothing".
 *
 * So the cases below are the matrix of what each layer can say, and the two that
 * matter most are the ones that must ALLOW: a cold index, and a total outage.
 * A revocation control that takes the application down with it will be removed
 * by the first person it pages, and then nothing checks anything.
 */
const jwt = require("jsonwebtoken");

const mockSessionStore = { isSessionActive: jest.fn(), indexSession: jest.fn(), removeSession: jest.fn(), listActiveSessionIds: jest.fn() };
const mockIdentityCache = { getAuthUser: jest.fn(), getGrants: jest.fn(), invalidateUser: jest.fn() };

jest.mock("../../src/shared/cache/session-store", () => mockSessionStore);
jest.mock("../../src/shared/cache/identity-cache", () => mockIdentityCache);

const { config } = require("../../src/config/env");
const { authMiddleware } = require("../../src/middleware/auth");

/** Build a request carrying a signed access token, with both layers stubbed. */
function makeReq({ sid, redis, db }) {
  const payload = { sub: "u1", typ: "access", jti: "j1" };
  if (sid) payload.sid = sid;
  const token = jwt.sign(payload, config.JWT_ACCESS_SECRET);
  mockSessionStore.isSessionActive.mockResolvedValue(redis);
  return {
    headers: { authorization: `Bearer ${token}` },
    identityDb: async (fn) => fn({ query: db }),
  };
}

/** Run the middleware and report the AppError code, or "allowed". */
async function outcome(req) {
  try {
    await authMiddleware(req, {}, (err) => { if (err) throw err; });
    return "allowed";
  } catch (err) {
    return err.code || err.message;
  }
}

const liveRow = async () => ({ rows: [{ killed_at: null }] });
const killedRow = async () => ({ rows: [{ killed_at: new Date() }] });
const noRow = async () => ({ rows: [] });
const dbDown = async () => { throw new Error("db unreachable"); };

beforeEach(() => {
  jest.clearAllMocks();
  mockIdentityCache.getAuthUser.mockResolvedValue({
    user_id: "u1", email: "a@b.c", status: "ACTIVE", role_ids: [],
  });
});

describe("SEC-M1 — access tokens respect session revocation", () => {
  it("allows a session the index says is live, without touching the database", async () => {
    // The happy path is every authenticated request in the system, so it must
    // cost one Redis EXISTS and no SQL. Asserting the OUTCOME alone would not
    // show that: with `dbDown` the check fails open through its catch and still
    // says "allowed", so a regression that queried on every request would pass.
    //
    // Count `query`, NOT `identityDb`. A first version of this test counted the
    // latter and failed — correctly — because `identityDb` is also how the user
    // projection is loaded, several lines earlier. `getAuthUser` is mocked here,
    // so it issues no SQL, which makes the query counter specific to the
    // session check.
    let queries = 0;
    const countingDb = async (...args) => { queries += 1; return dbDown(...args); };
    expect(await outcome(makeReq({ sid: "s1", redis: true, db: countingDb }))).toBe("allowed");
    expect(queries).toBe(0);
  });

  it("REJECTS a killed session", async () => {
    expect(await outcome(makeReq({ sid: "s1", redis: false, db: killedRow })))
      .toBe("SESSION_REVOKED");
  });

  it("rejects a session whose row is gone, because `sid` is only minted with one", async () => {
    expect(await outcome(makeReq({ sid: "s1", redis: false, db: noRow })))
      .toBe("SESSION_REVOKED");
  });

  it("allows when the index is COLD but Postgres says the session is live", async () => {
    // The Redis-restart case. This is the one that decides whether the control
    // is safe to keep switched on.
    expect(await outcome(makeReq({ sid: "s1", redis: false, db: liveRow })))
      .toBe("allowed");
  });

  it("allows — loudly — when neither layer can answer", async () => {
    // Both down. We cannot tell a revoked session from an unreachable one, and
    // refusing every request would turn a cache outage into a total sign-out.
    // The 15-minute window this closes is not worth that trade.
    expect(await outcome(makeReq({ sid: "s1", redis: null, db: dbDown })))
      .toBe("allowed");
  });

  it("allows a legacy token with no `sid`, rather than locking out everyone mid-deploy", async () => {
    // Tokens minted before SEC-C2 carry no sid. They expire on their own; the
    // alternative is signing out every active user the moment this ships.
    expect(await outcome(makeReq({ sid: null, redis: false, db: killedRow })))
      .toBe("allowed");
  });
});
