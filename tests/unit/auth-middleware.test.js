"use strict";

/**
 * TC-C2 — `authMiddleware()` was entirely uncovered, and the token-replay fix
 * that was patched into it had no regression test at all.
 *
 * THE REPLAY BUG, AND WHY IT NEEDS A TEST MORE THAN MOST FIXES
 *
 * Refresh tokens (`typ: "refresh"`) and 2FA-pending tokens
 * (`typ: "2fa_pending"`) are signed with the SAME secret as access tokens. So
 * `jwt.verify` accepts all three, and without a `typ` check either of the other
 * two could be presented on `Authorization: Bearer` and be honoured as a fully
 * authenticated session. A 2FA-pending token is issued to someone who has
 * supplied a password and NOT yet supplied a second factor — replaying it as an
 * access token skips 2FA entirely.
 *
 * The fix is four lines and looks obviously correct, which is exactly the
 * problem: it is the kind of guard a future refactor deletes while tidying,
 * because nothing visibly depends on it. This file is what makes it visible.
 *
 * Tokens are signed with the real `jsonwebtoken` and the real configured
 * secret — not stubbed — because the thing under test is whether a genuinely
 * valid signature of the wrong TYPE is refused. A stubbed verifier would prove
 * nothing.
 */

const jwt = require("jsonwebtoken");

/** The identity projection the cache would return for an active user. */
const ACTIVE_USER = {
  user_id: "11111111-1111-1111-1111-111111111111",
  email: "mark@example.com",
  display_name: "Mark",
  status: "ACTIVE",
  role_ids: ["role-clerk"],
  is_ceo: false,
};

let mockCacheUser = ACTIVE_USER;
let mockCtxStore = null;

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getAuthUser: async () => mockCacheUser,
}));
jest.mock("../../src/config/request-context", () => ({
  get: () => mockCtxStore,
  run: (ctx, fn) => fn(),
}));

let authMiddleware;
let config;

/** Minimal req/res the middleware actually touches. */
function makeReq(token, over = {}) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    identityDb: (fn) => fn({}),
    ...over,
  };
}

/** Run the middleware and return either the AppError it threw or null. */
async function run(req) {
  let nexted = false;
  try {
    await authMiddleware(req, {}, () => {
      nexted = true;
    });
  } catch (err) {
    return { error: err, nexted };
  }
  return { error: null, nexted };
}

describe("authMiddleware (TC-C2)", () => {
  beforeEach(() => {
    mockCacheUser = ACTIVE_USER;
    mockCtxStore = { tenant: "smartls", userId: null };
    jest.resetModules();
    ({ authMiddleware } = require("../../src/middleware/auth"));
    ({ config } = require("../../src/config/env"));
  });

  const sign = (payload, over = {}) =>
    jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: "15m", ...over });

  describe("token type — the replay regression", () => {
    it("accepts a token explicitly typed as an access token", async () => {
      const { error, nexted } = await run(
        makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "access" })),
      );
      expect(error).toBeNull();
      expect(nexted).toBe(true);
    });

    it("REFUSES a refresh token replayed as a bearer token", async () => {
      const { error, nexted } = await run(
        makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "refresh" })),
      );
      expect(nexted).toBe(false);
      expect(error.code).toBe("INVALID_TOKEN");
      expect(error.status).toBe(401);
    });

    it("REFUSES a 2FA-pending token, which would otherwise skip the second factor", async () => {
      const { error, nexted } = await run(
        makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "2fa_pending" })),
      );
      expect(nexted).toBe(false);
      expect(error.code).toBe("INVALID_TOKEN");
    });

    it("REFUSES any unrecognised type rather than allow-listing known-bad ones", async () => {
      // The guard is `typ && typ !== "access"`, i.e. deny-by-default. A future
      // token type invented elsewhere is refused here without anyone
      // remembering to add it to a list.
      const { error } = await run(
        makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "impersonation" })),
      );
      expect(error.code).toBe("INVALID_TOKEN");
    });

    it("still accepts a legacy token with no typ claim", async () => {
      // Tokens issued before `typ` existed must keep working until they expire,
      // or the fix logs out every signed-in user on deploy.
      const { error, nexted } = await run(
        makeReq(sign({ sub: ACTIVE_USER.user_id })),
      );
      expect(error).toBeNull();
      expect(nexted).toBe(true);
    });
  });

  describe("signature and expiry", () => {
    it("refuses a token signed with the wrong secret", async () => {
      const forged = jwt.sign(
        { sub: ACTIVE_USER.user_id, typ: "access" },
        "not-the-secret",
      );
      const { error } = await run(makeReq(forged));
      expect(error.code).toBe("INVALID_TOKEN");
    });

    it("distinguishes an expired token from an invalid one", async () => {
      // The client refresh flow keys on this: TOKEN_EXPIRED means "refresh and
      // retry", INVALID_TOKEN means "the session is gone". Collapsing them
      // would either log people out early or spin on a dead token.
      const expired = jwt.sign(
        { sub: ACTIVE_USER.user_id, typ: "access" },
        config.JWT_ACCESS_SECRET,
        {
          expiresIn: "-1s",
        },
      );
      const { error } = await run(makeReq(expired));
      expect(error.code).toBe("TOKEN_EXPIRED");
      expect(error.status).toBe(401);
    });

    it("refuses a malformed token", async () => {
      const { error } = await run(makeReq("not.a.jwt"));
      expect(error.code).toBe("INVALID_TOKEN");
    });
  });

  describe("the Authorization header itself", () => {
    it("refuses a request with no header", async () => {
      const { error } = await run(makeReq(null));
      expect(error.code).toBe("AUTH_REQUIRED");
      expect(error.status).toBe(401);
    });

    it("refuses a non-Bearer scheme", async () => {
      const { error } = await run({
        headers: { authorization: "Basic abc123" },
        identityDb: (f) => f({}),
      });
      expect(error.code).toBe("AUTH_REQUIRED");
    });
  });

  describe("account state", () => {
    it("refuses a suspended user holding a perfectly valid token", async () => {
      mockCacheUser = { ...ACTIVE_USER, status: "SUSPENDED" };
      const { error } = await run(
        makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "access" })),
      );
      expect(error.code).toBe("USER_INACTIVE");
    });

    it("refuses a token whose subject no longer exists", async () => {
      mockCacheUser = null;
      const { error } = await run(
        makeReq(sign({ sub: "deleted-user", typ: "access" })),
      );
      expect(error.code).toBe("USER_INACTIVE");
    });
  });

  describe("ordering and context", () => {
    it("fails loudly when tenantContext has not run", async () => {
      // A 500, not a 401: this is a wiring mistake, and reporting it as an auth
      // failure would send whoever debugs it looking at credentials.
      const req = makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "access" }));
      delete req.identityDb;
      const { error } = await run(req);
      expect(error.code).toBe("NO_TENANT_CONTEXT");
      expect(error.status).toBe(500);
    });

    it("backfills the ambient request context with the real actor (OBS-L3)", async () => {
      // tenantContext binds the context BEFORE auth runs, so userId was always
      // null and every log line carried a tenant with an empty user.
      await run(makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "access" })));
      expect(mockCtxStore.userId).toBe(ACTIVE_USER.user_id);
    });

    it("carries the session id so logout can revoke without being told (SEC-C2)", async () => {
      const req = makeReq(
        sign({ sub: ACTIVE_USER.user_id, typ: "access", sid: "session-42" }),
      );
      await run(req);
      expect(req.user.session_id).toBe("session-42");
    });

    it("degrades to a null session id on a token issued before sid existed", async () => {
      const req = makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "access" }));
      await run(req);
      expect(req.user.session_id).toBeNull();
    });

    it("never copies a password hash or secret onto req.user", async () => {
      mockCacheUser = {
        ...ACTIVE_USER,
        password_hash: "$argon2id$leak",
        totp_secret_enc: "leak",
      };
      const req = makeReq(sign({ sub: ACTIVE_USER.user_id, typ: "access" }));
      await run(req);
      expect(JSON.stringify(req.user)).not.toContain("leak");
    });
  });
});
