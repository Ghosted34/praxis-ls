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

function mockDeps() {
  jest.doMock("../../src/modules/security/app_user/webauthn.repo", () => ({
    listForUserWithKeys: jest.fn(async () => [CREDENTIAL_ROW]),
    getByCredentialId: jest.fn(async () => CREDENTIAL_ROW),
    insertCredential: jest.fn(async () => ({ credential_id: CRED_B64, label: null })),
    updateCounter: jest.fn(async () => undefined),
    listForUser: jest.fn(async () => []),
    deleteCredential: jest.fn(async () => null),
  }));
  jest.doMock("../../src/modules/security/app_user/app_user.repo", () => ({
    getUserSafe: jest.fn(async () => ({ user_id: USER_ID, email: "tom@example.com", full_name: "Tom", status: "ACTIVE" })),
    findByEmail: jest.fn(async () => ({ user_id: USER_ID, email: "tom@example.com", full_name: "Tom", status: "ACTIVE" })),
  }));
  jest.doMock("../../src/modules/security/app_user/app_user.service", () => ({
    issueSessionTokens: jest.fn(async () => ({ access_token: "a", refresh_token: "r" })),
  }));
}

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

    await service.authenticationOptions({}, { email: "tom@example.com", req });

    const { id } = calls.authOptions[0].allowCredentials[0];
    expect(Buffer.isBuffer(id) || id instanceof Uint8Array).toBe(true);
    expect(Buffer.from(id).toString("base64url")).toBe(CRED_B64);
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
