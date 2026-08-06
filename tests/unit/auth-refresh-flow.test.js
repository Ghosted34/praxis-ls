"use strict";

/**
 * TC-Q2 — `refresh()` untested; only its extracted predicate is.
 *
 * `tests/unit/auth-refresh-rotation.test.js` covers `refreshTokenReused(session,
 * payload)` thoroughly, and that file is candid about why: the flow around it is
 * dependency-heavy, so the security decision was extracted into a pure function
 * and tested there. The audit's objection is the right one:
 *
 *   > If a refactor stopped calling `refreshTokenReused`, all five tests still
 *   > pass.
 *
 * That is testing an implementation detail instead of an outcome, on the
 * session-hijacking defence. This file tests the outcome. The predicate tests
 * stay — they cover the truth table cheaply — but nothing here reaches for
 * `refreshTokenReused` by name, so deleting the call site fails these tests
 * even if the predicate itself is left perfect and untouched.
 *
 * WHAT IS ASSERTED, and why each one is load-bearing
 *
 *   - a token that is not a refresh token is rejected — `typ` confusion is how
 *     an access token gets replayed as a refresh token
 *   - a token signed with the ACCESS secret is rejected, which is the only
 *     thing making two separate secrets worth having
 *   - a killed session, and a session belonging to someone else, are refused
 *   - REUSE OF A ROTATED-AWAY TOKEN revokes the whole session — asserted end to
 *     end by rotating once and re-presenting the original token, never by
 *     calling the predicate
 *   - the 30-minute inactivity kill fires, and `keep_signed_in` opts out of it
 *     (0494 — the checkbox promised 30 days and this timeout quietly cut it to
 *     30 minutes)
 *   - the rotated ACCESS token still carries `sid` (SEC-C2 — without it, logout
 *     after one refresh silently reverts to revoking nothing)
 *
 * The JWT layer is REAL: tokens are signed and verified with the configured
 * secrets, so `typ`, `sid`, `jti` and wrong-secret rejection are all genuinely
 * exercised rather than asserted against a stub. Only the I/O edges — the repo,
 * Redis session store, identity cache and event emitter — are mocked.
 */

const jwt = require("jsonwebtoken");

// ── I/O edges, mocked ────────────────────────────────────────────────────────
//
// Module-scoped state the factories close over, so each test can set the world
// up without re-instantiating a mock. Mirrors the pattern in
// orchestration-outbox.test.js.

let mockSession = null; // the row getActiveSession returns
const mockCalls = {
  killSession: [],
  touchSession: [],
  setRefreshJti: [],
  removeSession: [],
  invalidateUser: [],
  events: [],
};

jest.mock("../../src/modules/security/app_user/app_user.repo", () => ({
  getActiveSession: async () => mockSession,
  killSession: async (client, sid, killedBy) => { mockCalls.killSession.push({ sid, killedBy }); },
  touchSession: async (client, sid) => { mockCalls.touchSession.push({ sid }); },
  setRefreshJti: async (client, sid, jti) => {
    mockCalls.setRefreshJti.push({ sid, jti });
    // The database is the source of truth for "the session's current token".
    // Reflecting the write back onto the session row is what lets a test
    // present the OLD token on a second call and get real reuse detection,
    // rather than a hand-asserted approximation of it.
    if (mockSession) mockSession.refresh_jti = jti;
  },
  roleNames: async () => [],
}));

jest.mock("../../src/shared/cache/session-store", () => ({
  indexSession: async () => {},
  listActiveSessionIds: async () => [],
  removeSession: async (sid, userId) => { mockCalls.removeSession.push({ sid, userId }); },
}));

jest.mock("../../src/shared/cache/identity-cache", () => ({
  invalidateUser: async (userId) => { mockCalls.invalidateUser.push(userId); },
  invalidateGrants: async () => {},
  getAuthUser: async () => null,
  getGrants: async () => [],
}));

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (client, e) => { mockCalls.events.push(e); },
  audit: async () => {},
  resolveActorId: async () => null,
  clearEventTypeCache: () => {},
  WATCHER_ROLE_CODES: [],
}));

const { config } = require("../../src/config/env");
const svc = require("../../src/modules/security/app_user/app_user.service");

// The client is never actually read — every query goes through the mocked repo.
// It exists so a call that bypasses the repo and queries directly is loud.
const client = {
  query() {
    throw new Error("refresh() issued a direct query; every read must go through the repo");
  },
};

const USER = "user-1";
const SID = "session-1";

function makeRefreshToken({ userId = USER, sessionId = SID, jti = "jti-1", typ = "refresh", secret = config.JWT_REFRESH_SECRET, expiresIn = "30d" } = {}) {
  return jwt.sign({ sub: userId, sid: sessionId, jti, typ }, secret, { expiresIn });
}

/** A live session, idle for `idleSeconds`, whose current refresh jti is `jti`. */
function liveSession({ jti = "jti-1", idleSeconds = 10, keepSignedIn = false } = {}) {
  return {
    session_id: SID,
    user_id: USER,
    killed_at: null,
    last_seen_at: new Date().toISOString(),
    refresh_jti: jti,
    keep_signed_in: keepSignedIn,
    idle_seconds: idleSeconds,
  };
}

async function expectRejection(promise, code) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  if (!err) throw new Error(`expected refresh() to throw ${code}, it resolved`);
  expect(err.code).toBe(code);
  expect(err.status).toBe(401);
  return err;
}

describe("refresh() end to end (TC-Q2)", () => {
  beforeEach(() => {
    mockSession = liveSession();
    for (const k of Object.keys(mockCalls)) mockCalls[k].length = 0;
  });

  describe("token validity", () => {
    it("rejects a malformed token", async () => {
      await expectRejection(svc.refresh(client, { refreshToken: "not-a-jwt" }), "INVALID_TOKEN");
    });

    it("rejects an expired refresh token", async () => {
      const token = makeRefreshToken({ expiresIn: "-1s" });
      await expectRejection(svc.refresh(client, { refreshToken: token }), "INVALID_TOKEN");
    });

    it("rejects an ACCESS token presented as a refresh token", async () => {
      // typ confusion. middleware/auth.js rejects typ !== "access" in the other
      // direction; this is the same guard on this side, and without it the two
      // token families collapse into one.
      const token = makeRefreshToken({ typ: "access" });
      await expectRejection(svc.refresh(client, { refreshToken: token }), "INVALID_TOKEN");
    });

    it("rejects a token signed with the access secret", async () => {
      // The only thing that makes JWT_ACCESS_SECRET != JWT_REFRESH_SECRET worth
      // enforcing at boot (env.js rejects them being equal).
      const token = makeRefreshToken({ secret: config.JWT_ACCESS_SECRET });
      await expectRejection(svc.refresh(client, { refreshToken: token }), "INVALID_TOKEN");
    });

    it("rejects a refresh token that carries no session id", async () => {
      const token = jwt.sign({ sub: USER, jti: "jti-1", typ: "refresh" }, config.JWT_REFRESH_SECRET, { expiresIn: "30d" });
      await expectRejection(svc.refresh(client, { refreshToken: token }), "INVALID_TOKEN");
    });
  });

  describe("session validity", () => {
    it("refuses a session that no longer exists", async () => {
      mockSession = null;
      await expectRejection(svc.refresh(client, { refreshToken: makeRefreshToken() }), "SESSION_REVOKED");
    });

    it("refuses a killed session", async () => {
      // Remote session-kill has to actually stop the refresh, or "sign out
      // everywhere" ends at the next fifteen-minute boundary and no further.
      mockSession = liveSession();
      mockSession.killed_at = new Date().toISOString();
      await expectRejection(svc.refresh(client, { refreshToken: makeRefreshToken() }), "SESSION_REVOKED");
    });

    it("refuses a token whose subject is not the session's owner", async () => {
      // A valid signature over someone else's session id.
      const token = makeRefreshToken({ userId: "user-2" });
      await expectRejection(svc.refresh(client, { refreshToken: token }), "SESSION_REVOKED");
    });
  });

  describe("rotation and reuse detection", () => {
    it("rotates the refresh token and records the new jti against the session", async () => {
      const token = makeRefreshToken({ jti: "jti-1" });
      const out = await svc.refresh(client, { refreshToken: token });

      expect(mockCalls.setRefreshJti).toHaveLength(1);
      const stamped = mockCalls.setRefreshJti[0];
      expect(stamped.sid).toBe(SID);
      expect(stamped.jti).not.toBe("jti-1");

      // The returned token must be the one that was stamped — if these drift,
      // the client stores a token the server will treat as reuse on next use.
      const rotated = jwt.verify(out.refresh_token, config.JWT_REFRESH_SECRET);
      expect(rotated.jti).toBe(stamped.jti);
      expect(rotated.sid).toBe(SID);
      expect(rotated.sub).toBe(USER);
      expect(rotated.typ).toBe("refresh");
    });

    it("revokes the whole session when a rotated-away token is presented again", async () => {
      // THE TEST TC-Q2 IS ABOUT. No reference to refreshTokenReused: rotate
      // once, then replay the original token the way a thief with a stolen
      // copy would. Remove the call site and this fails.
      const original = makeRefreshToken({ jti: "jti-1" });
      await svc.refresh(client, { refreshToken: original });
      expect(mockCalls.killSession).toHaveLength(0);

      const err = await expectRejection(svc.refresh(client, { refreshToken: original }), "SESSION_REVOKED");
      expect(err.message).toMatch(/reuse/i);

      // Revocation must be complete, not just an error to the caller: the row
      // is killed, Redis forgets the session, and the identity cache is
      // invalidated so no cached grant outlives it.
      expect(mockCalls.killSession).toHaveLength(1);
      expect(mockCalls.killSession[0]).toEqual({ sid: SID, killedBy: USER });
      expect(mockCalls.removeSession).toHaveLength(1);
      expect(mockCalls.invalidateUser).toContain(USER);

      const logout = mockCalls.events.filter((e) => e.eventTypeKey === "auth.logged_out");
      expect(logout).toHaveLength(1);
      expect(logout[0].payload).toMatchObject({ reason: "refresh_token_reuse" });
    });

    it("does not rotate or touch the session when reuse is detected", async () => {
      // A revoked session must not have been simultaneously refreshed. Getting
      // this wrong hands the attacker a working token on the way out.
      mockSession = liveSession({ jti: "current" });
      const stale = makeRefreshToken({ jti: "rotated-away" });
      await expectRejection(svc.refresh(client, { refreshToken: stale }), "SESSION_REVOKED");
      expect(mockCalls.setRefreshJti).toHaveLength(0);
      expect(mockCalls.touchSession).toHaveLength(0);
    });

    it("grandfathers a legacy session that has no jti stamped yet", async () => {
      // Sessions issued before rotation shipped have refresh_jti NULL. They
      // must keep working until their next refresh stamps one, or shipping
      // rotation logs the whole estate out.
      mockSession = liveSession({ jti: null });
      const out = await svc.refresh(client, { refreshToken: makeRefreshToken({ jti: "whatever" }) });
      expect(out.access_token).toBeTruthy();
      expect(mockCalls.killSession).toHaveLength(0);
      expect(mockCalls.setRefreshJti).toHaveLength(1);
      expect(mockCalls.setRefreshJti[0].jti).toBeTruthy();
    });
  });

  describe("inactivity enforcement (PRD §5.7 / 0494)", () => {
    it("kills a session idle past SESSION_INACTIVITY_MIN", async () => {
      mockSession = liveSession({ idleSeconds: config.SESSION_INACTIVITY_MIN * 60 + 1 });
      const err = await expectRejection(svc.refresh(client, { refreshToken: makeRefreshToken() }), "SESSION_EXPIRED");
      expect(err.message).toMatch(/inactivity/i);

      expect(mockCalls.killSession).toHaveLength(1);
      expect(mockCalls.removeSession).toHaveLength(1);
      expect(mockCalls.invalidateUser).toContain(USER);
      const logout = mockCalls.events.filter((e) => e.eventTypeKey === "auth.logged_out");
      expect(logout).toHaveLength(1);
      expect(logout[0].payload).toMatchObject({ reason: "inactivity_timeout" });
    });

    it("allows a session exactly at the boundary", async () => {
      // The check is `>`, not `>=`. Asserting the boundary is what stops a
      // later refactor from quietly making the window one sweep shorter.
      mockSession = liveSession({ idleSeconds: config.SESSION_INACTIVITY_MIN * 60 });
      const out = await svc.refresh(client, { refreshToken: makeRefreshToken() });
      expect(out.access_token).toBeTruthy();
      expect(mockCalls.killSession).toHaveLength(0);
    });

    it("exempts keep_signed_in from the idle kill without exempting it from revocation", async () => {
      mockSession = liveSession({ idleSeconds: config.SESSION_INACTIVITY_MIN * 600, keepSignedIn: true });
      const out = await svc.refresh(client, { refreshToken: makeRefreshToken() });
      expect(out.access_token).toBeTruthy();
      expect(mockCalls.killSession).toHaveLength(0);

      // Longer leash, not an exemption: reuse still revokes.
      const stale = makeRefreshToken({ jti: "rotated-away" });
      await expectRejection(svc.refresh(client, { refreshToken: stale }), "SESSION_REVOKED");
      expect(mockCalls.killSession).toHaveLength(1);
    });

    it("does not kill a session whose idle time is unknown", async () => {
      // getActiveSession can return a NULL idle_seconds if last_seen_at is
      // NULL. Number.isFinite guards it; a NaN comparison must not become a
      // logout.
      mockSession = liveSession();
      mockSession.idle_seconds = null;
      mockSession.last_seen_at = null;
      const out = await svc.refresh(client, { refreshToken: makeRefreshToken() });
      expect(out.access_token).toBeTruthy();
      expect(mockCalls.killSession).toHaveLength(0);
    });
  });

  describe("the happy path's contract", () => {
    it("carries sid through rotation (SEC-C2)", async () => {
      // Without this the original logout bug comes back after fifteen minutes
      // of use: the client holds a post-refresh access token with no sid, and
      // logout has nothing to revoke.
      const out = await svc.refresh(client, { refreshToken: makeRefreshToken() });
      const access = jwt.verify(out.access_token, config.JWT_ACCESS_SECRET);
      expect(access.sid).toBe(SID);
      expect(access.sub).toBe(USER);
      expect(access.typ).toBe("access");
      expect(access.jti).toBeTruthy();
    });

    it("bumps last_seen_at so the idle window is measured from this refresh", async () => {
      await svc.refresh(client, { refreshToken: makeRefreshToken() });
      expect(mockCalls.touchSession).toHaveLength(1);
      expect(mockCalls.touchSession[0].sid).toBe(SID);
    });

    it("returns the documented envelope", async () => {
      const out = await svc.refresh(client, { refreshToken: makeRefreshToken() });
      expect(out.token_type).toBe("Bearer");
      expect(out.expires_in).toBe(config.JWT_ACCESS_TTL);
      expect(Object.keys(out).sort()).toEqual(["access_token", "expires_in", "refresh_token", "token_type"]);
    });

    it("emits NO token-refreshed event (silent refresh is machine noise)", async () => {
      // The event was removed because it drowned the Control Tower's
      // self-scoped "Recent activity" feed — silent refresh fires every ~15
      // min on every active tab. See the "no emitEvent + no audit here on
      // purpose" comment in refresh() and the regression test at
      // tests/security/no-refresh-audits.test.js.
      await svc.refresh(client, { refreshToken: makeRefreshToken() });
      expect(mockCalls.events.filter((e) => e.eventTypeKey === "auth.token_refreshed")).toHaveLength(0);
      expect(mockCalls.events.filter((e) => e.eventTypeKey === "auth.logged_out")).toHaveLength(0);
    });

    it("issues a different access token on each refresh", async () => {
      // Distinct jti per issue; a reused jti would break per-token revocation.
      const a = await svc.refresh(client, { refreshToken: makeRefreshToken() });
      const b = await svc.refresh(client, { refreshToken: a.refresh_token });
      expect(jwt.verify(a.access_token, config.JWT_ACCESS_SECRET).jti)
        .not.toBe(jwt.verify(b.access_token, config.JWT_ACCESS_SECRET).jti);
    });

    it("lets a client refresh repeatedly by following the rotation", async () => {
      // The ordinary case, three hops deep: each returned token is accepted
      // exactly once and the session is never killed.
      let token = makeRefreshToken();
      for (let i = 0; i < 3; i += 1) {
         
        const out = await svc.refresh(client, { refreshToken: token });
        token = out.refresh_token;
      }
      expect(mockCalls.killSession).toHaveLength(0);
      expect(mockCalls.setRefreshJti).toHaveLength(3);
    });
  });
});
