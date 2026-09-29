"use strict";

/**
 * The device the SERVER remembers (known-device.js, 14230).
 *
 * The sign-in screen used to learn "this is Ama's laptop and her passkey is
 * here" only from localStorage, which Safari erases after seven days without a
 * visit and every browser evicts under disk pressure. An HttpOnly cookie is
 * outside both. These pin the properties that make that safe: the cookie is
 * unreadable by script, never crosses sites, cannot be planted from a sibling
 * subdomain in production, is stored only as a hash, and a failure to remember
 * never costs the sign-in it followed.
 */

const mockUpserts = [];
let mockUpsertError = null;
let mockLatest = null;

jest.mock("../../src/modules/security/app_user/known-device.repo", () => ({
  upsert: async (client, row) => {
    if (mockUpsertError) throw mockUpsertError;
    mockUpserts.push(row);
  },
  latestAccount: async (client, hash) => (mockLatest ? { ...mockLatest, _hash: hash } : null),
  forgetPasskey: async () => undefined,
  MAX_IDS: 10,
}));

const crypto = require("crypto");
const knownDevice = require("../../src/modules/security/app_user/known-device");

function fakeReq(cookie) {
  return {
    headers: { ...(cookie ? { cookie } : {}), "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15" },
    identityDb: (fn) => fn({}),
  };
}
function fakeRes() {
  const set = [];
  return { set, cookie: (name, value, opts) => set.push({ name, value, opts }) };
}

const TOKEN = crypto.randomBytes(32).toString("base64url");

beforeEach(() => {
  mockUpserts.length = 0;
  mockUpsertError = null;
  mockLatest = null;
});

describe("remember", () => {
  it("mints a device token on the first sign-in and sets it as an HttpOnly, Strict cookie", async () => {
    const res = fakeRes();
    await knownDevice.remember(fakeReq(), res, { userId: "u-1" });
    expect(res.set).toHaveLength(1);
    const { name, value, opts } = res.set[0];
    expect(name).toBe(knownDevice.COOKIE);
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    // 400 days — the browsers' ceiling — rolled forward at every sign-in.
    expect(opts.maxAge).toBe(400 * 24 * 60 * 60 * 1000);
  });

  it("stores only a hash of the token, never the token", async () => {
    const res = fakeRes();
    await knownDevice.remember(fakeReq(`${knownDevice.COOKIE}=${TOKEN}`), res, { userId: "u-1", credentialId: "cred-1" });
    expect(mockUpserts[0]).toMatchObject({ userId: "u-1", credentialId: "cred-1", label: "Safari on macOS" });
    expect(mockUpserts[0].deviceHash).toBe(crypto.createHash("sha256").update(TOKEN).digest("hex"));
    expect(JSON.stringify(mockUpserts[0])).not.toContain(TOKEN);
  });

  it("keeps the device's existing token rather than minting a second one", async () => {
    const res = fakeRes();
    await knownDevice.remember(fakeReq(`other=1; ${knownDevice.COOKIE}=${TOKEN}; x=y`), res, { userId: "u-1" });
    expect(res.set[0].value).toBe(TOKEN);
  });

  it("ignores a malformed cookie and mints a fresh one", async () => {
    const res = fakeRes();
    await knownDevice.remember(fakeReq(`${knownDevice.COOKIE}=not-a-token`), res, { userId: "u-1" });
    expect(res.set[0].value).not.toBe("not-a-token");
    expect(res.set[0].value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never fails the sign-in it follows", async () => {
    mockUpsertError = new Error("relation user_known_device does not exist");
    const res = fakeRes();
    await expect(knownDevice.remember(fakeReq(), res, { userId: "u-1" })).resolves.toBeUndefined();
    // …and does not hand out a cookie that points at nothing.
    expect(res.set).toHaveLength(0);
  });
});

describe("lookup", () => {
  it("knows nobody without a cookie", async () => {
    await expect(knownDevice.lookup(fakeReq())).resolves.toEqual({ account: null });
  });

  it("returns the greeting, the PIN flag and the passkeys that live on this device", async () => {
    mockLatest = { email: "ama@acme.cm", full_name: "Ama Nkeng", avatar_ref: null, has_quick_pin: true, passkeys: ["cred-1"] };
    const r = await knownDevice.lookup(fakeReq(`${knownDevice.COOKIE}=${TOKEN}`));
    expect(r).toEqual({
      account: { email: "ama@acme.cm", display_name: "Ama Nkeng", avatar_url: null, has_quick_pin: true, passkeys: ["cred-1"] },
    });
  });
});

describe("the cookie in production", () => {
  it("is a __Host- cookie: Secure, Path=/, no Domain — a sibling subdomain cannot plant or overwrite it", () => {
    jest.isolateModules(() => {
      jest.doMock("../../src/config/env", () => ({ config: { NODE_ENV: "production" } }));
      const prod = require("../../src/modules/security/app_user/known-device");
      expect(prod.COOKIE).toBe("__Host-praxis_device");
      const opts = prod.cookieOptions();
      expect(opts).toMatchObject({ secure: true, httpOnly: true, sameSite: "strict", path: "/" });
      expect(opts.domain).toBeUndefined();
    });
  });
});
