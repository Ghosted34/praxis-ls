"use strict";

/**
 * WebAuthn ↔ @simplewebauthn/server v9 wire shapes.
 *
 * The passkey feature shipped written against v10/v11's API while package.json
 * pins v9, and the two disagree in exactly the places this service touches.
 * None of it failed loudly: v9 took the wrong types, produced a payload the
 * browser could not decode, and the only symptom a user ever saw was "Something
 * went wrong. Try again." — after which no passkey could be registered by
 * anyone, on any device.
 *
 * Nothing in the suite could see that, because every existing test stops at the
 * service boundary and the mismatch lives in the argument types crossing it.
 * So these tests assert the CALL, not just the result:
 *
 *   - `userID` is a string. Given bytes, v9 emits
 *     user.id = {"type":"Buffer","data":[…]}, which is what broke registration.
 *   - descriptor ids are bytes. Given a base64url string, v9 silently yields
 *     an empty id, so exclude/allow lists stop naming any credential —
 *     a passkey could be enrolled twice and a scoped login stops being scoped.
 *   - authentication verify is handed `authenticator`, v9's spelling. v10
 *     renamed it to `credential`; passing that leaves v9 with no public key to
 *     check the signature against, so every passkey LOGIN fails.
 *
 * These are contract tests against the installed major. If the dependency is
 * ever moved to v10+, they are meant to fail — that is the signal to port the
 * three call sites in the same commit rather than discover it in production.
 */

const fs = require("fs");
const path = require("path");

const SERVICE = "../../src/modules/security/app_user/webauthn.service";

const CRED_B64 = "AAECAwQFBgcICQ";
const USER_ID = "4d1f6b2a-0000-4000-8000-000000000001";

/** Records what the service hands SimpleWebAuthn, then answers plausibly. */
function mockSimpleWebAuthn() {
  const calls = { registration: [], authOptions: [], verifyAuth: [] };
  jest.doMock("@simplewebauthn/server", () => ({
    generateRegistrationOptions: jest.fn(async (opts) => {
      calls.registration.push(opts);
      return { challenge: "chal-reg", user: { id: opts.userID }, excludeCredentials: opts.excludeCredentials };
    }),
    generateAuthenticationOptions: jest.fn(async (opts) => {
      calls.authOptions.push(opts);
      return { challenge: "chal-auth", allowCredentials: opts.allowCredentials };
    }),
    verifyAuthenticationResponse: jest.fn(async (opts) => {
      calls.verifyAuth.push(opts);
      return { verified: true, authenticationInfo: { newCounter: 7 } };
    }),
    verifyRegistrationResponse: jest.fn(async () => ({ verified: false })),
  }));
  return calls;
}

const CREDENTIAL_ROW = {
  credential_id: CRED_B64,
  user_id: USER_ID,
  public_key: Buffer.from("pubkey-bytes").toString("base64url"),
  counter: 3,
  transports: null,
};

function mockDeps({ stored = CREDENTIAL_ROW } = {}) {
  const repo = {
    listForUserWithKeys: jest.fn(async () => [CREDENTIAL_ROW]),
    getByCredentialId: jest.fn(async () => stored),
    insertCredential: jest.fn(async () => ({ credential_id: CRED_B64, label: null })),
    updateCounter: jest.fn(async () => undefined),
    listForUser: jest.fn(async () => []),
    deleteCredential: jest.fn(async () => null),
  };
  jest.doMock("../../src/modules/security/app_user/webauthn.repo", () => repo);
  // Enrolment's fresh-auth rule has its own tests (session-policy.test.js);
  // here the session is always fresh.
  jest.doMock("../../src/modules/security/app_user/session-policy", () => ({
    ...jest.requireActual("../../src/modules/security/app_user/session-policy"),
    assertFreshAuth: jest.fn(async () => ({ via: "recent_sign_in" })),
  }));
  jest.doMock("../../src/modules/notification/notification.repo", () => ({ insertForUser: jest.fn(async () => ({})) }));
  jest.doMock("../../src/shared/events/emit", () => ({ audit: jest.fn(async () => undefined), emitEvent: jest.fn(async () => undefined) }));
  jest.doMock("../../src/modules/security/app_user/app_user.repo", () => ({
    getUserSafe: jest.fn(async () => ({ user_id: USER_ID, email: "tom@example.com", full_name: "Tom", status: "ACTIVE" })),
    findByEmail: jest.fn(async () => ({ user_id: USER_ID, email: "tom@example.com", full_name: "Tom", status: "ACTIVE" })),
  }));
  jest.doMock("../../src/modules/security/app_user/app_user.service", () => ({
    issueSessionTokens: jest.fn(async () => ({ access_token: "a", refresh_token: "r" })),
  }));
  return repo;
}

function signAuthChallenge(claims) {
  const jwt = require("jsonwebtoken");
  const { config } = require("../../src/config/env");
  return jwt.sign(
    { typ: "webauthn_challenge", kind: "authentication", challenge: "chal-auth", ...claims },
    config.JWT_ACCESS_SECRET,
    { expiresIn: "5m" },
  );
}

const ASSERTION = { id: CRED_B64, rawId: CRED_B64, type: "public-key", response: {} };

const req = { headers: { origin: "https://app.praxis-ls.com" }, get: () => "app.praxis-ls.com", protocol: "https" };

describe("webauthn service ↔ @simplewebauthn/server v9", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("the installed major is still 9 — these tests describe v9's API", () => {
    // Read from disk: the package's `exports` map refuses a deep require of
    // its own package.json.
    const pkgPath = path.join(__dirname, "..", "..", "node_modules", "@simplewebauthn", "server", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    expect(pkg.version.split(".")[0]).toBe("9");
  });

  test("registration passes userID as a string, so user.id survives JSON", async () => {
    const calls = mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    const out = await service.registrationOptions({}, { userId: USER_ID, req });

    expect(typeof calls.registration[0].userID).toBe("string");
    expect(calls.registration[0].userID).toBe(USER_ID);
    // The regression in the wild: a Buffer here serialises as an object and the
    // browser cannot decode it, so assert on what actually reaches the client.
    expect(typeof JSON.parse(JSON.stringify(out)).user.id).toBe("string");
  });

  test("excludeCredentials ids are bytes that round-trip to the stored id", async () => {
    const calls = mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    await service.registrationOptions({}, { userId: USER_ID, req });

    const { id } = calls.registration[0].excludeCredentials[0];
    expect(Buffer.isBuffer(id) || id instanceof Uint8Array).toBe(true);
    expect(Buffer.from(id).toString("base64url")).toBe(CRED_B64);
  });

  test("allowCredentials ids are bytes too, so a scoped login stays scoped", async () => {
    const calls = mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    await service.authenticationOptions({}, { email: "tom@example.com", credentialIds: [CRED_B64], req });

    const { id, transports } = calls.authOptions[0].allowCredentials[0];
    expect(Buffer.isBuffer(id) || id instanceof Uint8Array).toBe(true);
    expect(Buffer.from(id).toString("base64url")).toBe(CRED_B64);
    // THIS device's authenticator — not a chooser, not a phone's QR code.
    expect(transports).toEqual(["internal"]);
  });

  test("authentication verify uses v9's `authenticator`, not v10's `credential`", async () => {
    const calls = mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);
    const jwt = require("jsonwebtoken");
    const { config } = require("../../src/config/env");
    const challengeToken = jwt.sign(
      { typ: "webauthn_challenge", kind: "authentication", challenge: "chal-auth", sub: USER_ID, email: "tom@example.com" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "5m" },
    );

    await service.verifyAuthentication(
      {},
      { assertion: { id: CRED_B64, rawId: CRED_B64, response: {} }, challengeToken, req, ip: "1.2.3.4", userAgent: "jest" },
    );

    const opts = calls.verifyAuth[0];
    expect(opts.credential).toBeUndefined();
    expect(opts.authenticator).toBeDefined();
    expect(Buffer.from(opts.authenticator.credentialID).toString("base64url")).toBe(CRED_B64);
    expect(opts.authenticator.credentialPublicKey).toBeInstanceOf(Uint8Array);
    expect(opts.authenticator.counter).toBe(3);
  });

  test("an assertion is refused when the challenge names a different account", async () => {
    mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);
    const jwt = require("jsonwebtoken");
    const { config } = require("../../src/config/env");
    const challengeToken = jwt.sign(
      { typ: "webauthn_challenge", kind: "authentication", challenge: "chal-auth", sub: "11111111-2222-3333-4444-555555555555" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "5m" },
    );

    await expect(
      service.verifyAuthentication(
        {},
        { assertion: { id: CRED_B64, rawId: CRED_B64, response: {} }, challengeToken, req },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  });

  test("a discoverable login signs sub=anonymous and is not bound to an identity", async () => {
    mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);
    const jwt = require("jsonwebtoken");
    const { config } = require("../../src/config/env");
    const challengeToken = jwt.sign(
      { typ: "webauthn_challenge", kind: "authentication", challenge: "chal-auth", sub: "anonymous" },
      config.JWT_ACCESS_SECRET,
      { expiresIn: "5m" },
    );

    await expect(
      service.verifyAuthentication(
        {},
        { assertion: { id: CRED_B64, rawId: CRED_B64, response: {} }, challengeToken, req },
      ),
    ).resolves.toBeDefined();
  });
});

/*
 * The security decisions in webauthn.service.js's header, one test each. These
 * assert what the service hands SimpleWebAuthn (and what it refuses before
 * SimpleWebAuthn is asked), because every one of them used to be the opposite
 * and nothing failed.
 */
describe("passkey security decisions", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("registration demands user verification, a discoverable key and THIS device's authenticator", async () => {
    const calls = mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    await service.registrationOptions({}, { userId: USER_ID, req });

    expect(calls.registration[0].authenticatorSelection).toMatchObject({
      userVerification: "required",
      residentKey: "required",
      authenticatorAttachment: "platform",
    });
  });

  test("sign-in verification requires user verification (a bare tap is not two factors)", async () => {
    const calls = mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    await service.verifyAuthentication({}, { assertion: ASSERTION, challengeToken: signAuthChallenge({ sub: "tom@example.com", email: "tom@example.com" }), req });

    expect(calls.verifyAuth[0].requireUserVerification).toBe(true);
    expect(calls.authOptions).toHaveLength(0);
  });

  test("sign-in options read no table, so they cannot tell anyone whether an account exists", async () => {
    const calls = mockSimpleWebAuthn();
    const repo = mockDeps();
    const service = require(SERVICE);

    const out = await service.authenticationOptions({}, { email: "nobody@example.com", req });

    expect(repo.listForUserWithKeys).not.toHaveBeenCalled();
    expect(repo.getByCredentialId).not.toHaveBeenCalled();
    expect(calls.authOptions[0].userVerification).toBe("required");
    // No device hint: a discoverable ceremony, never a 404.
    expect(calls.authOptions[0].allowCredentials).toBeUndefined();
    expect(out._challengeToken).toEqual(expect.any(String));
  });

  test("a challenge answers once — a replayed assertion is refused", async () => {
    mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);
    const challengeToken = signAuthChallenge({ sub: "tom@example.com", email: "tom@example.com" });

    await service.verifyAuthentication({}, { assertion: ASSERTION, challengeToken, req });
    await expect(
      service.verifyAuthentication({}, { assertion: ASSERTION, challengeToken, req }),
    ).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  });

  test("the lock screen for one account cannot be unlocked by another account's passkey", async () => {
    mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    await expect(
      service.verifyAuthentication({}, {
        assertion: ASSERTION,
        challengeToken: signAuthChallenge({ sub: "ama@example.com", email: "ama@example.com" }),
        req,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  });

  test("a passkey the account no longer holds says so, naming the credential for the device to forget", async () => {
    mockSimpleWebAuthn();
    mockDeps({ stored: null });
    const service = require(SERVICE);

    await expect(
      service.verifyAuthentication({}, { assertion: ASSERTION, challengeToken: signAuthChallenge({ sub: "anonymous" }), req }),
    ).rejects.toMatchObject({ code: "PASSKEY_REVOKED", details: { credential_id: CRED_B64 } });
  });

  test("the verified sign-in reports which credential signed, so the device can remember it", async () => {
    mockSimpleWebAuthn();
    mockDeps();
    const service = require(SERVICE);

    const out = await service.verifyAuthentication({}, { assertion: ASSERTION, challengeToken: signAuthChallenge({ sub: "anonymous" }), req });
    expect(out.credential_id).toBe(CRED_B64);
  });

  test("in production the origin is the host we served, and a different Origin header is refused", () => {
    jest.doMock("../../src/config/env", () => {
      const actual = jest.requireActual("../../src/config/env");
      return { ...actual, config: { ...actual.config, NODE_ENV: "production" } };
    });
    mockDeps();
    const service = require(SERVICE);

    const good = { headers: { origin: "https://acme.praxisls.com", host: "acme.praxisls.com" }, get: () => "acme.praxisls.com" };
    expect(service.getRpInfo(good)).toEqual({ rpID: "acme.praxisls.com", rpName: "Praxis LS", origin: "https://acme.praxisls.com" });

    // No Origin header (some privacy setups strip it): still the host, never the Referer.
    const noOrigin = { headers: { referer: "https://evil.example/x", host: "acme.praxisls.com" }, get: () => "acme.praxisls.com" };
    expect(service.getRpInfo(noOrigin).origin).toBe("https://acme.praxisls.com");

    const forged = { headers: { origin: "https://evil.example", host: "acme.praxisls.com" }, get: () => "acme.praxisls.com" };
    expect(() => service.getRpInfo(forged)).toThrow(expect.objectContaining({ code: "ORIGIN_MISMATCH" }));
  });

  test("an enrolment gets a readable label from the device when none is given", () => {
    mockDeps();
    const service = require(SERVICE);
    expect(service.labelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Safari on macOS");
    expect(service.labelFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(service.labelFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0")).toBe("Edge on Windows");
  });
});
