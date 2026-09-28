"use strict";

/**
 * 14150 — "keep me signed in", emailed sign-in codes, and the client team's
 * access scope, for the external portal.
 *
 * THE PROPERTIES THIS FILE HOLDS
 *
 *   1. A refresh token is a session, not a password: only its hash is stored,
 *      it ROTATES on every use, and a rotated-away token presented again after
 *      the grace window ends the whole session (a replay or a leak — either
 *      way nobody should keep going). Inside the window it is two tabs racing,
 *      and the loser still gets an access token.
 *   2. A session dies with its user and with "sign out that device": the
 *      access token minted under a revoked session is refused at once, not
 *      when it expires.
 *   3. An emailed code is single use, short-lived, limited to five guesses, and
 *      every failure looks the same — wrong code, expired, unknown email.
 *   4. Requesting a code never reveals whether the email has an account.
 *   5. A client-team member only reaches the areas their scope allows, and only
 *      an admin manages the team.
 *
 * REAL: jsonwebtoken, crypto. MOCKED: the repo (in memory), the mailer, the
 * portal-access lookup.
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

let mockUsers = [];
let mockSessions = [];
let mockCodes = [];
let mockMail = [];
let mockGrant = { allowed: true, grant: null };

jest.mock("../../src/modules/portal_auth/portal_auth.repo", () => ({
  findByEmail: async (c, email) => mockUsers.find((u) => u.email === String(email).toLowerCase()) || null,
  findById: async (c, id) => mockUsers.find((u) => u.portal_user_id === id) || null,
  touchLogin: async () => {},
  bumpFailed: async () => {},
  revokeAllSessions: async (c, id) => {
    for (const s of mockSessions) if (s.portal_user_id === id && !s.revoked_at) s.revoked_at = new Date();
  },
  insertSession: async (c, row) => {
    const s = {
      portal_session_id: `ps-${mockSessions.length + 1}`,
      portal_user_id: row.portalUserId,
      refresh_hash: row.refreshHash,
      prev_refresh_hash: null,
      rotated_at: null,
      method: row.method,
      device_label: row.deviceLabel,
      expires_at: row.expiresAt,
      revoked_at: null,
    };
    mockSessions.push(s);
    return s;
  },
  findSessionByRefresh: async (c, hash) => {
    const s = mockSessions.find((x) => x.refresh_hash === hash || x.prev_refresh_hash === hash);
    return s ? { ...s, is_current: s.refresh_hash === hash } : null;
  },
  rotateSession: async (c, { sessionId, fromHash, toHash, expiresAt }) => {
    const s = mockSessions.find((x) => x.portal_session_id === sessionId && x.refresh_hash === fromHash && !x.revoked_at);
    if (!s) return null;
    s.prev_refresh_hash = s.refresh_hash;
    s.refresh_hash = toHash;
    s.rotated_at = new Date();
    s.expires_at = expiresAt;
    return s;
  },
  touchSession: async () => {},
  revokeSession: async (c, id, userId = null) => {
    const s = mockSessions.find((x) => x.portal_session_id === id && !x.revoked_at && (!userId || x.portal_user_id === userId));
    if (!s) return null;
    s.revoked_at = new Date();
    return s;
  },
  revokeSessionByHash: async (c, hash) => {
    const s = mockSessions.find((x) => x.refresh_hash === hash);
    if (s) s.revoked_at = new Date();
  },
  sessionIsLive: async (c, id) => {
    const s = mockSessions.find((x) => x.portal_session_id === id);
    return !!s && !s.revoked_at && new Date(s.expires_at) > new Date();
  },
  listSessions: async (c, id) => mockSessions.filter((s) => s.portal_user_id === id && !s.revoked_at),
  countRecentLoginCodes: async (c, id) => mockCodes.filter((x) => x.portal_user_id === id).length,
  retireLoginCodes: async (c, id) => {
    for (const x of mockCodes) if (x.portal_user_id === id && !x.used_at) x.used_at = new Date();
  },
  insertLoginCode: async (c, row) => {
    const x = {
      portal_login_code_id: `lc-${mockCodes.length + 1}`,
      portal_user_id: row.portalUserId,
      code_hash: row.codeHash,
      expires_at: row.expiresAt,
      attempts: 0,
      used_at: null,
    };
    mockCodes.push(x);
    return x;
  },
  latestLoginCode: async (c, id) =>
    mockCodes
      .filter((x) => x.portal_user_id === id && !x.used_at && new Date(x.expires_at) > new Date())
      .slice(-1)[0] || null,
  bumpLoginCodeAttempts: async (c, codeId) => {
    const x = mockCodes.find((y) => y.portal_login_code_id === codeId);
    x.attempts += 1;
    return x.attempts;
  },
  useLoginCode: async (c, codeId) => {
    const x = mockCodes.find((y) => y.portal_login_code_id === codeId && !y.used_at);
    if (!x) return null;
    x.used_at = new Date();
    return x;
  },
}));

jest.mock("../../src/services/email.service", () => ({
  send: async (c, msg) => {
    mockMail.push(msg);
  },
}));

jest.mock("../../src/modules/portal/portal.service", () => ({
  checkAccess: async () => mockGrant,
}));

const { config } = require("../../src/config/env");
const svc = require("../../src/modules/portal_auth/portal_auth.service");
const {
  portalAuth,
  portalScope,
  portalClientAdmin,
} = require("../../src/modules/portal_auth/portal_auth.middleware");

const client = {};

async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection, the call resolved");
}

/** The code inside the last mail, read the way a person would. */
const lastCode = () => {
  const text = mockMail[mockMail.length - 1].text;
  return /(\d{6})/.exec(text)[1];
};

const reqFor = (token) => ({
  headers: { authorization: `Bearer ${token}` },
  identityDb: (fn) => fn(client),
  tenantDb: (fn) => fn(client),
});
const run = (mw, req) =>
  new Promise((resolve, reject) => {
    Promise.resolve(mw(req, {}, (err) => (err ? reject(err) : resolve(true)))).catch(reject);
  });

const ada = { portal_user_id: "pu-1", email: "ada@acme.example", full_name: "Ada Client", status: "ACTIVE" };

describe("portal trusted-device sessions (14150)", () => {
  beforeEach(() => {
    mockUsers = [{ ...ada }];
    mockSessions = [];
    mockCodes = [];
    mockMail = [];
    mockGrant = { allowed: true, grant: null };
  });

  it("without the tick there is no session and no refresh token", async () => {
    const out = await svc.issueTokens(client, ada, { trust: false });
    expect(out.refresh_token).toBeUndefined();
    expect(out.trusted).toBe(false);
    expect(mockSessions).toHaveLength(0);
    expect(jwt.verify(out.access_token, config.JWT_ACCESS_SECRET).sid).toBeUndefined();
  });

  it("with the tick it stores only the HASH of the refresh token and binds the access token to the session", async () => {
    const out = await svc.issueTokens(client, ada, { trust: true, method: "code", userAgent: "Mozilla/5.0 (iPhone)" });
    expect(out.refresh_token).toBeTruthy();
    expect(mockSessions).toHaveLength(1);
    expect(mockSessions[0].refresh_hash).toBe(sha256(out.refresh_token));
    expect(mockSessions[0].refresh_hash).not.toContain(out.refresh_token);
    expect(mockSessions[0].device_label).toBe("iPhone");
    expect(jwt.verify(out.access_token, config.JWT_ACCESS_SECRET).sid).toBe(mockSessions[0].portal_session_id);
  });

  it("a refresh rotates the token, and the new one works", async () => {
    const first = await svc.issueTokens(client, ada, { trust: true });
    const second = await svc.refresh(client, { refreshToken: first.refresh_token });
    expect(second.refresh_token).toBeTruthy();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const third = await svc.refresh(client, { refreshToken: second.refresh_token });
    expect(third.access_token).toBeTruthy();
  });

  it("two tabs racing inside the grace window: the loser still gets an access token, and no new refresh token", async () => {
    const first = await svc.issueTokens(client, ada, { trust: true });
    await svc.refresh(client, { refreshToken: first.refresh_token });
    const loser = await svc.refresh(client, { refreshToken: first.refresh_token });
    expect(loser.access_token).toBeTruthy();
    expect(loser.refresh_token).toBeNull();
    expect(mockSessions[0].revoked_at).toBeNull();
  });

  it("a rotated-away token presented after the grace window ends the whole session", async () => {
    const first = await svc.issueTokens(client, ada, { trust: true });
    const second = await svc.refresh(client, { refreshToken: first.refresh_token });
    mockSessions[0].rotated_at = new Date(Date.now() - 5 * 60 * 1000);
    const err = await rejection(svc.refresh(client, { refreshToken: first.refresh_token }));
    expect(err.code).toBe("SESSION_EXPIRED");
    expect(mockSessions[0].revoked_at).not.toBeNull();
    // …including for the holder of the CURRENT token.
    const after = await rejection(svc.refresh(client, { refreshToken: second.refresh_token }));
    expect(after.code).toBe("SESSION_EXPIRED");
  });

  it("an unknown token, a revoked session and a disabled user all end the same way", async () => {
    const unknown = await rejection(svc.refresh(client, { refreshToken: "x".repeat(43) }));
    const out = await svc.issueTokens(client, ada, { trust: true });
    await svc.logout(client, { refreshToken: out.refresh_token });
    const revoked = await rejection(svc.refresh(client, { refreshToken: out.refresh_token }));
    const again = await svc.issueTokens(client, ada, { trust: true });
    mockUsers[0].status = "DISABLED";
    const disabled = await rejection(svc.refresh(client, { refreshToken: again.refresh_token }));
    for (const e of [unknown, revoked, disabled]) {
      expect(e.code).toBe("SESSION_EXPIRED");
      expect(e.status).toBe(401);
    }
  });

  it("signing a device out refuses its access token at once, not at expiry", async () => {
    const out = await svc.issueTokens(client, ada, { trust: true });
    expect(await run(portalAuth(), reqFor(out.access_token))).toBe(true);
    await svc.revokeSession(client, { portalUserId: "pu-1", sessionId: mockSessions[0].portal_session_id });
    const err = await rejection(run(portalAuth(), reqFor(out.access_token)));
    expect(err.code).toBe("SESSION_EXPIRED");
  });

  it("a person cannot sign out somebody else's device", async () => {
    await svc.issueTokens(client, ada, { trust: true });
    const err = await rejection(svc.revokeSession(client, { portalUserId: "pu-other", sessionId: mockSessions[0].portal_session_id }));
    expect(err.status).toBe(404);
    expect(mockSessions[0].revoked_at).toBeNull();
  });
});

describe("emailed sign-in codes (14150)", () => {
  beforeEach(() => {
    mockUsers = [{ ...ada }];
    mockSessions = [];
    mockCodes = [];
    mockMail = [];
  });

  it("asking for a code answers the same for a known and an unknown email, and only mails the known one", async () => {
    const known = await svc.requestCode(client, { email: "ada@acme.example", tenantName: "Acme Logistics" });
    const unknown = await svc.requestCode(client, { email: "nobody@acme.example", tenantName: "Acme Logistics" });
    expect(unknown).toEqual(known);
    expect(mockMail).toHaveLength(1);
    expect(mockMail[0].to).toBe("ada@acme.example");
    expect(lastCode()).toMatch(/^\d{6}$/);
    // The code is never stored in the clear.
    expect(mockCodes[0].code_hash).not.toContain(lastCode());
  });

  it("the right code signs in once, and only once", async () => {
    await svc.requestCode(client, { email: "ada@acme.example" });
    const code = lastCode();
    const out = await svc.verifyCode(client, { email: "ada@acme.example", code, trust: true });
    expect(out.access_token).toBeTruthy();
    expect(out.refresh_token).toBeTruthy();
    const replay = await rejection(svc.verifyCode(client, { email: "ada@acme.example", code }));
    expect(replay.code).toBe("INVALID_CODE");
  });

  it("asking again retires the previous code", async () => {
    await svc.requestCode(client, { email: "ada@acme.example" });
    const first = lastCode();
    await svc.requestCode(client, { email: "ada@acme.example" });
    const second = lastCode();
    if (first !== second) {
      const err = await rejection(svc.verifyCode(client, { email: "ada@acme.example", code: first }));
      expect(err.code).toBe("INVALID_CODE");
    }
    expect((await svc.verifyCode(client, { email: "ada@acme.example", code: second })).access_token).toBeTruthy();
  });

  it("five wrong guesses lock the code, even against the right one", async () => {
    await svc.requestCode(client, { email: "ada@acme.example" });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      const err = await rejection(svc.verifyCode(client, { email: "ada@acme.example", code: wrong }));
      expect(err.code).toBe("INVALID_CODE");
    }
    const locked = await rejection(svc.verifyCode(client, { email: "ada@acme.example", code }));
    expect(locked.code).toBe("INVALID_CODE");
  });

  it("every failure reads the same — wrong code, unknown email, disabled account", async () => {
    await svc.requestCode(client, { email: "ada@acme.example" });
    const wrong = await rejection(svc.verifyCode(client, { email: "ada@acme.example", code: "999999" === lastCode() ? "888888" : "999999" }));
    const unknown = await rejection(svc.verifyCode(client, { email: "nobody@acme.example", code: "123456" }));
    mockUsers[0].status = "DISABLED";
    const disabled = await rejection(svc.verifyCode(client, { email: "ada@acme.example", code: lastCode() }));
    for (const e of [unknown, disabled]) {
      expect(e.code).toBe(wrong.code);
      expect(e.message).toBe(wrong.message);
      expect(e.status).toBe(wrong.status);
    }
  });

  it("stops minting codes past the hourly cap without telling the caller", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await svc.requestCode(client, { email: "ada@acme.example" })).toEqual({ ok: true });
    }
    expect(mockMail.length).toBeLessThanOrEqual(6);
  });
});

describe("client team scope and admin checks (14150)", () => {
  const reqWith = (grant) => ({ portal: { scope: (grant && grant.access_scope) || "ALL", grant } });

  it("ALL reaches every area", () => {
    const req = reqWith({ access_scope: "ALL" });
    expect(() => portalScope("OPERATIONS")(req, {}, () => {})).not.toThrow();
    expect(() => portalScope("BILLING")(req, {}, () => {})).not.toThrow();
  });

  it("a billing-only colleague cannot open shipments, and an operations-only one cannot open billing", () => {
    expect(() => portalScope("OPERATIONS")(reqWith({ access_scope: "BILLING" }), {}, () => {})).toThrow(
      expect.objectContaining({ code: "PORTAL_SCOPE", status: 403 }),
    );
    expect(() => portalScope("BILLING")(reqWith({ access_scope: "OPERATIONS" }), {}, () => {})).toThrow(
      expect.objectContaining({ code: "PORTAL_SCOPE" }),
    );
  });

  it("only a client admin manages the team", () => {
    expect(() => portalClientAdmin(reqWith({ is_client_admin: false }), {}, () => {})).toThrow(
      expect.objectContaining({ code: "PORTAL_ADMIN_REQUIRED" }),
    );
    let called = false;
    portalClientAdmin(reqWith({ is_client_admin: true }), {}, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("the middleware carries the grant's scope onto the request", async () => {
    mockUsers = [{ ...ada }];
    mockGrant = { allowed: true, grant: { client_id: "cl-1", access_scope: "BILLING", is_client_admin: false } };
    const { access_token } = await svc.issueTokens(client, ada, { trust: false });
    const req = reqFor(access_token);
    await run(portalAuth("CLIENT"), req);
    expect(req.portal.scope).toBe("BILLING");
    expect(req.portal.clientId).toBe("cl-1");
  });
});
