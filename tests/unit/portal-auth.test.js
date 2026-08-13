"use strict";

/**
 * TC-C10 — portal auth at 3.2% functions.
 *
 * This is the only authentication surface in the product that faces people
 * outside the company: client contacts, investors and auditors. An auditor
 * grant exposes the tenant's full financial statements and general-ledger
 * trail; a client grant exposes that client's dossiers, invoices and
 * receivables ageing. It is also the surface least likely to have a password
 * manager behind it, and it was the least tested thing in the repository.
 *
 * Portal auth is deliberately parallel to staff auth and deliberately OFF the
 * RBAC path, which means none of the app_user or RBAC tests say anything about
 * it. Everything it does, it does alone.
 *
 * THE FOUR PROPERTIES THIS FILE EXISTS TO HOLD
 *
 *   1. A portal token is not a staff token. Both are signed with
 *      JWT_ACCESS_SECRET, so `typ` is the ONLY thing standing between a portal
 *      login and the staff API. Asserted from both directions.
 *   2. The token grants identity, never scope. `portal_access` is re-checked on
 *      every request, so revoking a grant cuts access immediately rather than
 *      at the next token expiry.
 *   3. Failures do not enumerate. Unknown email, wrong password, disabled
 *      account — one error. Unknown, used and expired invite tokens — one
 *      error. Asserted by comparing the errors to each other, not by eyeballing
 *      the strings.
 *   4. SEC H6 stays fixed: portal passwords go through the same policy staff
 *      passwords do. `password` and `12345678` both used to pass.
 *
 * REAL vs MOCKED: argon2, jsonwebtoken and the password policy are REAL —
 * hashing, token typing and strength rules are the things under test and a stub
 * would assert nothing. The database repo, the portal-access lookup and the
 * mailer are mocked.
 */

const jwt = require("jsonwebtoken");
const argon2 = require("argon2");

// ── no unit test may touch the network ───────────────────────────────────────
//
// password-policy calls HIBP's range API and FAILS OPEN when it is unreachable.
// Left alone that is a live HTTP request from a unit test — the same defect
// already found in error-reporter (see tests/jest.setup.js). Stubbing fetch to
// reject pins the fail-open branch deterministically AND proves no request
// leaves the process: `fetchCalls` must stay at zero everywhere except the one
// test that asserts the breach check was attempted.
let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network disabled in unit tests");
};

// ── mocked edges ─────────────────────────────────────────────────────────────

let mockUsers = [];
let mockInvites = [];
let mockAccessGrant = { allowed: false, grant: null };
let mockMailFails = false;

const mockCalls = {
  bumpFailed: [],
  touchLogin: [],
  setPassword: [],
  setStatus: [],
  createInvite: [],
  invalidateInvites: [],
  markInviteUsed: [],
  insert: [],
  mail: [],
};

const mockByEmail = (e) =>
  mockUsers.find(
    (u) =>
      u.email ===
      String(e || "")
        .trim()
        .toLowerCase(),
  ) || null;
const mockById = (id) => mockUsers.find((u) => u.portal_user_id === id) || null;

jest.mock("../../src/modules/portal_auth/portal_auth.repo", () => ({
  findByEmail: async (c, email) => mockByEmail(email),
  findById: async (c, id) => mockById(id),
  insert: async (c, { email, passwordHash, fullName }) => {
    const row = {
      portal_user_id: `pu-${mockUsers.length + 1}`,
      email,
      password_hash: passwordHash,
      full_name: fullName,
      status: "ACTIVE",
    };
    mockUsers.push(row);
    mockCalls.insert.push(row);
    return row;
  },
  setPassword: async (c, id, hash) => {
    const u = mockById(id);
    if (!u) return null;
    u.password_hash = hash;
    mockCalls.setPassword.push({ id, hash });
    return u;
  },
  setStatus: async (c, id, status) => {
    const u = mockById(id);
    if (!u) return null;
    u.status = status;
    mockCalls.setStatus.push({ id, status });
    return u;
  },
  touchLogin: async (c, id) => {
    mockCalls.touchLogin.push(id);
  },
  bumpFailed: async (c, id) => {
    mockCalls.bumpFailed.push(id);
  },
  list: async () => mockUsers,
  createInvite: async (c, inv) => {
    mockInvites.push({
      invite_id: `inv-${mockInvites.length + 1}`,
      used_at: null,
      ...inv,
    });
    mockCalls.createInvite.push(inv);
  },
  invalidateInvites: async (c, id) => {
    mockCalls.invalidateInvites.push(id);
    for (const i of mockInvites)
      if (i.portalUserId === id) i.used_at = new Date().toISOString();
  },
  findInviteByHash: async (c, hash) => {
    const i = mockInvites.find((x) => x.tokenHash === hash);
    if (!i) return null;
    const u = mockById(i.portalUserId);
    return {
      ...i,
      portal_user_id: i.portalUserId,
      expires_at: i.expiresAt,
      email: u ? u.email : null,
    };
  },
  markInviteUsed: async (c, inviteId) => {
    const i = mockInvites.find((x) => x.invite_id === inviteId);
    if (i) i.used_at = new Date().toISOString();
    mockCalls.markInviteUsed.push(inviteId);
  },
  inviteStatus: async () => ({ pending: false }),
}));

jest.mock("../../src/services/email.service", () => ({
  send: async (c, msg) => {
    if (mockMailFails) throw new Error("SMTP down");
    mockCalls.mail.push(msg);
  },
}));

jest.mock("../../src/modules/portal/portal.service", () => ({
  checkAccess: async () => mockAccessGrant,
}));

const { config } = require("../../src/config/env");
const svc = require("../../src/modules/portal_auth/portal_auth.service");
const {
  portalAuth,
} = require("../../src/modules/portal_auth/portal_auth.middleware");

const client = {};
const GOOD = "Tr0ubador!Quay7";
const OTHER_GOOD = "Zephyr#Lantern42";

/** Captures the AppError a promise rejects with, and fails loudly if it resolves. */
async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection, the call resolved");
}

let goodHash;

describe("portal auth (TC-C10)", () => {
  beforeEach(async () => {
    if (!goodHash)
      goodHash = await argon2.hash(GOOD, { type: argon2.argon2id });
    mockUsers = [
      {
        portal_user_id: "pu-1",
        email: "client@acme.example",
        password_hash: goodHash,
        full_name: "Ada Client",
        status: "ACTIVE",
      },
    ];
    mockInvites = [];
    mockAccessGrant = { allowed: false, grant: null };
    mockMailFails = false;
    fetchCalls = 0;
    for (const k of Object.keys(mockCalls)) mockCalls[k].length = 0;
  });

  describe("login", () => {
    it("issues a token for correct credentials and records the login", async () => {
      const out = await svc.login(client, {
        email: "client@acme.example",
        password: GOOD,
      });
      expect(out.access_token).toBeTruthy();
      expect(out.portal_user).toEqual({
        portal_user_id: "pu-1",
        email: "client@acme.example",
        full_name: "Ada Client",
      });
      expect(mockCalls.touchLogin).toEqual(["pu-1"]);
      expect(mockCalls.bumpFailed).toHaveLength(0);
    });

    it("never leaks the password hash to the caller", async () => {
      const out = await svc.login(client, {
        email: "client@acme.example",
        password: GOOD,
      });
      expect(JSON.stringify(out)).not.toMatch(/\$argon2/);
    });

    it("counts a wrong password as a failed attempt", async () => {
      const err = await rejection(
        svc.login(client, {
          email: "client@acme.example",
          password: "wrong-but-strong-9!",
        }),
      );
      expect(err.code).toBe("BAD_CREDENTIALS");
      expect(err.status).toBe(401);
      expect(mockCalls.bumpFailed).toEqual(["pu-1"]);
      expect(mockCalls.touchLogin).toHaveLength(0);
    });

    it("gives an unknown email and a wrong password the SAME error", async () => {
      // Account enumeration, asserted by comparison rather than by reading the
      // strings — a later edit to one message alone now fails here.
      const unknown = await rejection(
        svc.login(client, { email: "nobody@acme.example", password: GOOD }),
      );
      const wrong = await rejection(
        svc.login(client, {
          email: "client@acme.example",
          password: "wrong-but-strong-9!",
        }),
      );
      expect(unknown.code).toBe(wrong.code);
      expect(unknown.message).toBe(wrong.message);
      expect(unknown.status).toBe(wrong.status);
    });

    it("refuses a disabled account with that same error, and does not count an attempt", async () => {
      // A disabled external account is the revocation path for a client whose
      // contract ended. It must fail closed, and it must not be distinguishable
      // from a bad password.
      mockUsers[0].status = "DISABLED";
      const err = await rejection(
        svc.login(client, { email: "client@acme.example", password: GOOD }),
      );
      expect(err.code).toBe("BAD_CREDENTIALS");
      expect(mockCalls.bumpFailed).toHaveLength(0);
      expect(mockCalls.touchLogin).toHaveLength(0);
    });

    it("does not throw when the stored hash is unusable", async () => {
      // inviteUser() creates logins with a random unusable password. Someone
      // trying to sign in before accepting the invite must get the generic
      // error, not a 500 out of argon2.
      mockUsers[0].password_hash = "not-a-valid-argon2-hash";
      const err = await rejection(
        svc.login(client, { email: "client@acme.example", password: GOOD }),
      );
      expect(err.code).toBe("BAD_CREDENTIALS");
    });
  });

  describe("the portal/staff token boundary", () => {
    // Portal tokens and staff access tokens are signed with the SAME secret
    // (JWT_ACCESS_SECRET). `typ` is the entire boundary.

    it("stamps typ:portal and carries identity only", async () => {
      const { access_token } = await svc.login(client, {
        email: "client@acme.example",
        password: GOOD,
      });
      const payload = jwt.verify(access_token, config.JWT_ACCESS_SECRET);
      expect(payload.typ).toBe("portal");
      expect(payload.sub).toBe("pu-1");
      expect(payload.email).toBe("client@acme.example");
      // No scope in the token: the grant is re-read per request so a revoke
      // takes effect now rather than at expiry.
      expect(payload.role).toBeUndefined();
      expect(payload.capabilities).toBeUndefined();
      expect(payload.client_id).toBeUndefined();
      expect(payload.tenant_id).toBeUndefined();
    });

    it("refuses a STAFF access token", async () => {
      // The attack this stops: sign in to the portal, present the staff token
      // you were somehow issued, reach the tenant API. Valid signature, wrong
      // typ.
      const staff = jwt.sign(
        { sub: "user-1", jti: "j", sid: "s", typ: "access" },
        config.JWT_ACCESS_SECRET,
        { expiresIn: "15m" },
      );
      const err = await rejection(
        Promise.resolve().then(() => svc.verifyToken(staff)),
      );
      expect(err.code).toBe("INVALID_TOKEN");
      expect(err.status).toBe(401);
    });

    it("refuses a 2FA-pending token", async () => {
      const pending = jwt.sign(
        { sub: "user-1", typ: "2fa_pending" },
        config.JWT_ACCESS_SECRET,
        { expiresIn: "5m" },
      );
      const err = await rejection(
        Promise.resolve().then(() => svc.verifyToken(pending)),
      );
      expect(err.code).toBe("INVALID_TOKEN");
    });

    it("refuses a token signed with the refresh secret", async () => {
      const forged = jwt.sign(
        { sub: "pu-1", typ: "portal" },
        config.JWT_REFRESH_SECRET,
        { expiresIn: "2h" },
      );
      const err = await rejection(
        Promise.resolve().then(() => svc.verifyToken(forged)),
      );
      expect(err.code).toBe("INVALID_TOKEN");
    });

    it("distinguishes an expired portal token from an invalid one", async () => {
      // The client needs to know to re-authenticate rather than to give up.
      const expired = jwt.sign(
        { sub: "pu-1", typ: "portal" },
        config.JWT_ACCESS_SECRET,
        { expiresIn: "-1s" },
      );
      const err = await rejection(
        Promise.resolve().then(() => svc.verifyToken(expired)),
      );
      expect(err.code).toBe("TOKEN_EXPIRED");
      expect(err.status).toBe(401);
    });

    it("refuses a malformed token", async () => {
      const err = await rejection(
        Promise.resolve().then(() => svc.verifyToken("garbage")),
      );
      expect(err.code).toBe("INVALID_TOKEN");
    });
  });

  describe("password policy on external accounts (SEC H6)", () => {
    it("rejects the exact passwords that used to pass", async () => {
      // The old check was `String(password).length < 8`. These two are the
      // regression, named.
      for (const weak of ["password", "12345678"]) {
        const err = await rejection(
          svc.createUser(client, {
            email: "new@acme.example",
            password: weak,
            fullName: "New",
          }),
        );
        expect(err.code).toBe("WEAK_PASSWORD");
        expect(err.status).toBe(422);
      }
      expect(mockCalls.insert).toHaveLength(0);
    });

    it("rejects a long password that is missing a character class", async () => {
      const err = await rejection(
        svc.createUser(client, {
          email: "new@acme.example",
          password: "aaaaaaaaaaaaaaaaaaaa",
          fullName: "New",
        }),
      );
      expect(err.code).toBe("WEAK_PASSWORD");
    });

    it("rejects a password containing the email local part", async () => {
      const err = await rejection(
        svc.createUser(client, {
          email: "hauling@acme.example",
          password: "Hauling#Rig4422",
          fullName: "New",
        }),
      );
      expect(err.code).toBe("WEAK_PASSWORD");
      expect(err.message).toMatch(/name part of your email/i);
    });

    it("consults the breach corpus and fails open when it is unreachable", async () => {
      // Fail-open is deliberate: an HIBP outage must not block a legitimate
      // reset. The assertion is that the check was ATTEMPTED — silently
      // dropping it would be indistinguishable otherwise.
      const before = fetchCalls;
      await svc.createUser(client, {
        email: "new@acme.example",
        password: GOOD,
        fullName: "New",
      });
      expect(fetchCalls).toBeGreaterThan(before);
      expect(mockCalls.insert).toHaveLength(1);
    });

    it("stores an argon2id hash, never the password", async () => {
      await svc.createUser(client, {
        email: "new@acme.example",
        password: GOOD,
        fullName: "New",
      });
      const created = mockCalls.insert[0];
      expect(created.password_hash).toMatch(/^\$argon2id\$/);
      expect(created.password_hash).not.toContain(GOOD);
      expect(await argon2.verify(created.password_hash, GOOD)).toBe(true);
    });

    it("refuses a duplicate email", async () => {
      const err = await rejection(
        svc.createUser(client, {
          email: "client@acme.example",
          password: GOOD,
          fullName: "Dup",
        }),
      );
      expect(err.code).toBe("EMAIL_TAKEN");
      expect(err.status).toBe(409);
    });

    it("applies the same policy to an admin set-password", async () => {
      const err = await rejection(
        svc.setPassword(client, { id: "pu-1", password: "password" }),
      );
      expect(err.code).toBe("WEAK_PASSWORD");
      expect(mockCalls.setPassword).toHaveLength(0);
    });

    it("404s a set-password for an unknown user before hashing anything", async () => {
      const err = await rejection(
        svc.setPassword(client, { id: "pu-nope", password: GOOD }),
      );
      expect(err.code).toBe("NOT_FOUND");
      expect(err.status).toBe(404);
    });
  });

  describe("invitations and recovery (0482)", () => {
    /** Runs the staff invite and digs the one-time token back out of the mail. */
    async function invite(
      email = "invitee@acme.example",
      fullName = "Ivy Invitee",
    ) {
      const out = await svc.inviteUser(client, {
        email,
        fullName,
        origin: "https://portal.example",
      });
      const link =
        mockCalls.mail[mockCalls.mail.length - 1].text.match(
          /token=([a-f0-9]+)/,
        );
      return { out, token: link ? decodeURIComponent(link[1]) : null };
    }

    it("creates a login for a brand-new invitee with an unusable password", async () => {
      const { out, token } = await invite();
      expect(out.created).toBe(true);
      expect(out.emailed).toBe(true);
      expect(token).toBeTruthy();

      // Nobody, staff included, should hold a value that signs in as an
      // external party. The row exists; no password works on it yet.
      const created = mockCalls.insert[0];
      expect(created.password_hash).toMatch(/^\$argon2id\$/);
      const err = await rejection(
        svc.login(client, { email: "invitee@acme.example", password: GOOD }),
      );
      expect(err.code).toBe("BAD_CREDENTIALS");
    });

    it("reuses an existing login rather than failing on a second grant", async () => {
      const { out } = await invite("client@acme.example");
      expect(out.created).toBe(false);
      expect(out.portal_user_id).toBe("pu-1");
      expect(mockCalls.insert).toHaveLength(0);
    });

    it("reactivates a disabled login when it is re-invited", async () => {
      // Otherwise the invite lands, the user sets a password, and the sign-in
      // still fails with the generic error.
      mockUsers[0].status = "DISABLED";
      await invite("client@acme.example");
      expect(mockCalls.setStatus).toEqual([{ id: "pu-1", status: "ACTIVE" }]);
    });

    it("keeps the login and the token when the mail fails, and says so", async () => {
      mockMailFails = true;
      const out = await svc.inviteUser(client, {
        email: "invitee@acme.example",
        fullName: "Ivy",
      });
      expect(out.emailed).toBe(false);
      expect(out.portal_user_id).toBeTruthy();
      expect(mockCalls.createInvite).toHaveLength(1); // resendable
    });

    it("keeps only one live link at a time", async () => {
      await invite();
      await invite();
      expect(mockCalls.invalidateInvites).toHaveLength(2);
      const live = mockInvites.filter((i) => !i.used_at);
      expect(live).toHaveLength(1);
    });

    it("stores the token hashed, never in the clear", async () => {
      const { token } = await invite();
      expect(mockInvites[0].tokenHash).not.toBe(token);
      expect(mockInvites[0].tokenHash).toHaveLength(64);
    });

    it("gives an invite a week and a reset thirty minutes", async () => {
      // 0482: an invite reaches someone who has never used the system and may
      // open it days later; a reset is requested by someone at the screen.
      const { out } = await invite();
      expect(out.emailed).toBe(true);
      const inviteTtl =
        new Date(mockInvites[0].expiresAt).getTime() - Date.now();
      expect(inviteTtl).toBeGreaterThan(6 * 24 * 3600 * 1000);

      mockInvites = [];
      await svc.requestReset(client, { email: "client@acme.example" });
      const resetTtl =
        new Date(mockInvites[0].expiresAt).getTime() - Date.now();
      expect(resetTtl).toBeLessThan(31 * 60 * 1000);
      expect(resetTtl).toBeGreaterThan(29 * 60 * 1000);
    });

    it("answers a reset for an unknown email identically, and mints nothing", async () => {
      const unknown = await svc.requestReset(client, {
        email: "nobody@acme.example",
      });
      const known = await svc.requestReset(client, {
        email: "client@acme.example",
      });
      expect(unknown).toEqual({ ok: true });
      expect(unknown).toEqual(known);
      // The observable difference is only ever the mail itself.
      expect(mockInvites).toHaveLength(1);
      expect(mockInvites[0].portalUserId).toBe("pu-1");
    });

    it("mints nothing for a disabled user's reset", async () => {
      mockUsers[0].status = "DISABLED";
      const out = await svc.requestReset(client, {
        email: "client@acme.example",
      });
      expect(out).toEqual({ ok: true });
      expect(mockInvites).toHaveLength(0);
    });

    it("does not reject a reset when the mail fails", async () => {
      mockMailFails = true;
      const out = await svc.requestReset(client, {
        email: "client@acme.example",
      });
      expect(out).toEqual({ ok: true });
    });

    it("accepts a valid invite, sets the password and signs the user in", async () => {
      const { token } = await invite();
      const out = await svc.acceptInvite(client, {
        token,
        password: OTHER_GOOD,
      });

      expect(jwt.verify(out.access_token, config.JWT_ACCESS_SECRET).typ).toBe(
        "portal",
      );
      expect(mockCalls.markInviteUsed).toHaveLength(1);

      // The password that was set is the password that now works.
      const login = await svc.login(client, {
        email: "invitee@acme.example",
        password: OTHER_GOOD,
      });
      expect(login.access_token).toBeTruthy();
    });

    it("burns the link — the same token cannot be used twice", async () => {
      const { token } = await invite();
      await svc.acceptInvite(client, { token, password: OTHER_GOOD });
      const err = await rejection(
        svc.acceptInvite(client, { token, password: "Another#Pass99" }),
      );
      expect(err.code).toBe("INVALID_INVITE");
    });

    it("gives unknown, used and expired tokens one indistinguishable error", async () => {
      const { token: used } = await invite("used@acme.example");
      await svc.acceptInvite(client, { token: used, password: OTHER_GOOD });

      const { token: expiring } = await invite("expired@acme.example");
      mockInvites.find((i) => i.tokenHash && !i.used_at).expiresAt = new Date(
        Date.now() - 1000,
      );

      const errs = [
        await rejection(
          svc.acceptInvite(client, { token: "deadbeef", password: OTHER_GOOD }),
        ),
        await rejection(
          svc.acceptInvite(client, { token: used, password: OTHER_GOOD }),
        ),
        await rejection(
          svc.acceptInvite(client, { token: expiring, password: OTHER_GOOD }),
        ),
        await rejection(
          svc.acceptInvite(client, { token: "", password: OTHER_GOOD }),
        ),
      ];
      for (const e of errs) {
        expect(e.code).toBe(errs[0].code);
        expect(e.message).toBe(errs[0].message);
        expect(e.status).toBe(errs[0].status);
      }
      expect(errs[0].code).toBe("INVALID_INVITE");
    });

    it("checks the token before the password, so policy errors leak no token state", async () => {
      // A weak password against an UNKNOWN token must give the invite error,
      // not the policy error — otherwise the response distinguishes tokens that
      // once existed.
      const err = await rejection(
        svc.acceptInvite(client, { token: "deadbeef", password: "password" }),
      );
      expect(err.code).toBe("INVALID_INVITE");
    });

    it("does not consume the invite when the chosen password is rejected", async () => {
      // Otherwise one typo costs the invitee their link.
      const { token } = await invite();
      const err = await rejection(
        svc.acceptInvite(client, { token, password: "password" }),
      );
      expect(err.code).toBe("WEAK_PASSWORD");
      expect(mockCalls.markInviteUsed).toHaveLength(0);

      const ok = await svc.acceptInvite(client, {
        token,
        password: OTHER_GOOD,
      });
      expect(ok.access_token).toBeTruthy();
    });

    it("refuses an invite whose user was disabled after it was sent", async () => {
      const { token } = await invite();
      mockUsers[mockUsers.length - 1].status = "DISABLED";
      const err = await rejection(
        svc.acceptInvite(client, { token, password: OTHER_GOOD }),
      );
      expect(err.code).toBe("INVALID_INVITE");
      expect(mockCalls.setPassword).toHaveLength(0);
    });
  });

  describe("the portalAuth middleware — where the grant is actually enforced", () => {
    function reqFor(token) {
      return {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        identityDb: (fn) => fn(client),
        tenantDb: (fn) => fn(client),
      };
    }
    async function run(mw, req) {
      let nexted = false;
      await mw(req, {}, () => {
        nexted = true;
      });
      return nexted;
    }
    async function tokenFor() {
      const { access_token } = await svc.login(client, {
        email: "client@acme.example",
        password: GOOD,
      });
      return access_token;
    }

    it("requires a bearer token", async () => {
      const err = await rejection(run(portalAuth("CLIENT"), reqFor(null)));
      expect(err.code).toBe("AUTH_REQUIRED");
      expect(err.status).toBe(401);
    });

    it("rejects a non-bearer authorization header", async () => {
      const req = {
        headers: { authorization: "Basic Zm9vOmJhcg==" },
        identityDb: (fn) => fn(client),
        tenantDb: (fn) => fn(client),
      };
      const err = await rejection(run(portalAuth("CLIENT"), req));
      expect(err.code).toBe("AUTH_REQUIRED");
    });

    it("rejects a staff access token at the gate, not just in the service", async () => {
      const staff = jwt.sign(
        { sub: "user-1", jti: "j", sid: "s", typ: "access" },
        config.JWT_ACCESS_SECRET,
        { expiresIn: "15m" },
      );
      const err = await rejection(run(portalAuth("CLIENT"), reqFor(staff)));
      expect(err.code).toBe("INVALID_TOKEN");
    });

    it("refuses a still-valid token once the account is disabled", async () => {
      // Property 2, first half: the token alone grants nothing. Disabling an
      // account must bite before its 2h token expires.
      const token = await tokenFor();
      mockUsers[0].status = "DISABLED";
      const err = await rejection(run(portalAuth("CLIENT"), reqFor(token)));
      expect(err.code).toBe("PORTAL_USER_INACTIVE");
      expect(err.status).toBe(401);
    });

    it("refuses a valid token that has no grant for the portal it asked for", async () => {
      // Property 2, second half. A CLIENT user reaching for the AUDITOR portal
      // is a 403, and it is decided here rather than by the token.
      mockAccessGrant = { allowed: false, grant: null };
      const err = await rejection(
        run(portalAuth("AUDITOR"), reqFor(await tokenFor())),
      );
      expect(err.code).toBe("PORTAL_FORBIDDEN");
      expect(err.status).toBe(403);
    });

    it("attaches the freshly-read grant when access is allowed", async () => {
      mockAccessGrant = {
        allowed: true,
        grant: { client_id: "cl-9", portal: "CLIENT" },
      };
      const req = reqFor(await tokenFor());
      expect(await run(portalAuth("CLIENT"), req)).toBe(true);
      expect(req.portal.user.portal_user_id).toBe("pu-1");
      expect(req.portal.portal).toBe("CLIENT");
      expect(req.portal.clientId).toBe("cl-9");
      expect(req.portal.grant).toEqual({ client_id: "cl-9", portal: "CLIENT" });
    });

    it("re-reads the grant on every request rather than trusting the token", async () => {
      // The revocation guarantee, stated as a test: same token, grant pulled,
      // next request refused.
      mockAccessGrant = { allowed: true, grant: { client_id: "cl-9" } };
      const token = await tokenFor();
      expect(await run(portalAuth("CLIENT"), reqFor(token))).toBe(true);

      mockAccessGrant = { allowed: false, grant: null };
      const err = await rejection(run(portalAuth("CLIENT"), reqFor(token)));
      expect(err.code).toBe("PORTAL_FORBIDDEN");
    });

    it("requires only a signed-in user when called with no portal type", async () => {
      // /portal/me. No grant check, and clientId stays null so nothing
      // downstream mistakes it for a scope.
      const req = reqFor(await tokenFor());
      expect(await run(portalAuth(), req)).toBe(true);
      expect(req.portal.portal).toBeNull();
      expect(req.portal.clientId).toBeNull();
      expect(req.portal.grant).toBeNull();
    });

    it("authenticates without touching the network", async () => {
      // Guard on the guard: the only thing in this module that may reach out is
      // the breach check on password writes. A gate that made a network call
      // per request would be a latency and availability problem on the external
      // surface, so it is measured ACROSS a full pass — reading the counter
      // after a beforeEach reset would assert nothing at all.
      mockAccessGrant = { allowed: true, grant: { client_id: "cl-9" } };
      const token = await tokenFor();
      const before = fetchCalls;
      expect(await run(portalAuth("CLIENT"), reqFor(token))).toBe(true);
      expect(fetchCalls).toBe(before);
    });
  });
});
