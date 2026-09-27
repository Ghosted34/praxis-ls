"use strict";

/**
 * Session policy — the two-hour ceiling's arithmetic, and the fresh-auth rule
 * that stops a stolen access token becoming a permanent way into an account.
 */

jest.mock("argon2", () => ({
  verify: jest.fn(async (hash, pw) => hash === `hash:${pw}`),
}));

const { config } = require("../../src/config/env");
const policy = require("../../src/modules/security/app_user/session-policy");

/** A client that answers the two queries assertFreshAuth makes. */
function clientWith({ sessionAge = null, passwordHash = "hash:correct", status = "ACTIVE" } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM user_session/.test(sql)) return { rows: sessionAge === null || sessionAge === undefined ? [] : [{ age_seconds: sessionAge }] };
      if (/FROM app_user/.test(sql)) return { rows: [{ password_hash: passwordHash, status }] };
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
}

describe("ttlSeconds", () => {
  it.each([
    ["15m", 900],
    ["30d", 2592000],
    ["2h", 7200],
    ["45", 45],
    ["45s", 45],
    [3600, 3600],
  ])("%s → %s seconds", (input, out) => {
    expect(policy.ttlSeconds(input)).toBe(out);
  });

  it("falls back on nonsense rather than minting a token that never expires", () => {
    expect(policy.ttlSeconds("forever", 900)).toBe(900);
  });
});

describe("the two-hour ceiling", () => {
  const MAX = config.SESSION_MAX_AGE_MIN * 60;

  it("is two hours by default — the owner's rule", () => {
    expect(config.SESSION_MAX_AGE_MIN).toBe(120);
    expect(policy.maxAgeSeconds()).toBe(7200);
  });

  it("counts down from sign-in and never goes negative", () => {
    expect(policy.remainingSeconds(0)).toBe(MAX);
    expect(policy.remainingSeconds(MAX - 1)).toBe(1);
    expect(policy.remainingSeconds(MAX + 500)).toBe(0);
  });

  it("treats an unknown age as a new session, never as a mass sign-out", () => {
    expect(policy.remainingSeconds(null)).toBe(MAX);
    expect(policy.remainingSeconds(undefined)).toBe(MAX);
  });

  it("caps token lifetimes at what is left of the session", () => {
    expect(policy.accessTtlFor(MAX)).toBe(15 * 60);
    expect(policy.accessTtlFor(120)).toBe(120);
    expect(policy.refreshTtlFor(MAX)).toBe(MAX);
    expect(policy.refreshTtlFor(42)).toBe(42);
  });
});

describe("assertFreshAuth — enrolling a new way to sign in", () => {
  const args = { sessionId: "s-1", userId: "u-1" };

  it("allows it straight after signing in, without asking for anything", async () => {
    await expect(policy.assertFreshAuth(clientWith({ sessionAge: 60 }), args)).resolves.toEqual({ via: "recent_sign_in" });
  });

  it("asks for the password once the sign-in is no longer fresh", async () => {
    const age = config.CREDENTIAL_ENROL_WINDOW_MIN * 60 + 1;
    await expect(policy.assertFreshAuth(clientWith({ sessionAge: age }), args)).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
      status: 403,
    });
  });

  it("accepts the right password on a stale session", async () => {
    await expect(
      policy.assertFreshAuth(clientWith({ sessionAge: 99999 }), { ...args, currentPassword: "correct" }),
    ).resolves.toEqual({ via: "password" });
  });

  it("refuses the wrong password with a 403, never a 401 that would lock the screen", async () => {
    await expect(
      policy.assertFreshAuth(clientWith({ sessionAge: 99999 }), { ...args, currentPassword: "wrong" }),
    ).rejects.toMatchObject({ code: "INVALID_CURRENT_PASSWORD", status: 403 });
  });

  it("treats a token with no session (pre-binding) or a killed session as stale", async () => {
    await expect(policy.assertFreshAuth(clientWith({ sessionAge: null }), args)).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    await expect(policy.assertFreshAuth(clientWith({ sessionAge: 10 }), { ...args, sessionId: null })).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
    });
  });
});
