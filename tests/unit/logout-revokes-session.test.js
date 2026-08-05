"use strict";

/**
 * SEC-C2 (Critical) — logout must actually end the session.
 *
 * The defect: logout is authenticated by the ACCESS token, but the access token
 * carried only `{ sub, jti }` — no session id. So `logout()` read
 * `req.body.session_id`, which the client never sends, skipped the entire
 * revocation block, and returned `{ logged_out: true }`.
 *
 * The session row stayed alive and the refresh token stayed valid. Signing out
 * on a shared machine ended nothing, and anyone holding the refresh token could
 * keep minting access tokens.
 *
 * The fix binds `sid` into the access token, so the caller cannot fail to
 * supply it and cannot substitute someone else's. These assertions were also
 * run against the pre-fix service: four of the six fail there.
 */

const path = require("path");

const SERVICE = "../../src/modules/security/app_user/app_user.service";

function load() {
  jest.resetModules();
  const killed = [];
  const removed = [];

  jest.doMock("../../src/modules/security/app_user/app_user.repo", () => ({
    killSession: jest.fn(async (_c, sid, by) => { killed.push([sid, by]); }),
    recordLoginSuccess: jest.fn(async () => {}),
    createSession: jest.fn(async () => "sess-abc"),
    setRefreshJti: jest.fn(async () => {}),
  }));
  jest.doMock("../../src/shared/cache/session-store", () => ({
    removeSession: jest.fn(async (sid, u) => { removed.push([sid, u]); }),
    indexSession: jest.fn(async () => {}),
  }));
  jest.doMock("../../src/shared/cache/identity-cache", () => ({
    invalidateUser: jest.fn(async () => {}),
  }));
  jest.doMock("../../src/shared/events/emit", () => ({
    emitEvent: jest.fn(async () => {}),
    audit: jest.fn(async () => {}),
    resolveActorId: jest.fn(async (c, id) => id || null),
  }));

  return { service: require(SERVICE), killed, removed };
}

afterEach(() => jest.resetModules());

describe("SEC-C2 — logout revokes the caller's session", () => {
  it("revokes the session named in the TOKEN, with no body parameter", async () => {
    // The regression. Before the fix this revoked nothing at all.
    const { service, killed, removed } = load();
    const out = await service.logout({}, {
      actor: { user_id: "u1", session_id: "sess-abc" },
      sessionId: null,
    });

    expect(killed).toEqual([["sess-abc", "u1"]]);
    expect(removed).toEqual([["sess-abc", "u1"]]);
    expect(out.session_revoked).toBe(true);
  });

  it("clears the Redis session index as well as the DB row", async () => {
    // Both matter: the row gates refresh, the index gates the session list.
    const { service, removed } = load();
    await service.logout({}, { actor: { user_id: "u1", session_id: "sess-abc" }, sessionId: null });
    expect(removed[0][0]).toBe("sess-abc");
  });

  it("scopes the kill to the acting user (SEC-M2)", async () => {
    // killSession had no ownership predicate, so a caller could revoke any
    // session id they could guess. The acting user is always passed.
    const { service, killed } = load();
    await service.logout({}, {
      actor: { user_id: "u1", session_id: "sess-abc" },
      sessionId: "some-other-session",
    });
    expect(killed).toEqual([["some-other-session", "u1"]]);
  });

  describe("a token issued before this shipped (no sid)", () => {
    it("revokes nothing — there is nothing to identify", async () => {
      const { service, killed } = load();
      await service.logout({}, { actor: { user_id: "u1" }, sessionId: null });
      expect(killed).toEqual([]);
    });

    it("SAYS SO rather than reporting success", async () => {
      // The heart of the finding: the old code returned an unconditional
      // { logged_out: true }. A response that claims to have done something it
      // did not is worse than an error, because nobody investigates it.
      const { service } = load();
      const out = await service.logout({}, { actor: { user_id: "u1" }, sessionId: null });
      expect(out.session_revoked).toBe(false);
    });
  });
});

describe("SEC-C2 — the access token is bound to its session", () => {
  it("every signAccessToken call site passes a sessionId", () => {
    // Both issuance paths must carry it. Missing it on the refresh-rotation
    // path would reintroduce the bug after fifteen minutes of use, which is
    // worse than never fixing it — it would look fixed in testing.
    const fs = require("fs");
    const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "src/modules/security/app_user/app_user.service.js"), "utf8");

    const callSites = src.match(/signAccessToken\(\{[^}]*\}\)/g) || [];
    // One definition-shaped match plus the real call sites.
    const invocations = callSites.filter((c) => !c.includes("userId, jti, sessionId }"));

    expect(invocations.length).toBeGreaterThanOrEqual(2);
    for (const call of invocations) {
      expect(call).toMatch(/sessionId/);
    }
  });
});
