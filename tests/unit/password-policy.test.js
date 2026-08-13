"use strict";
// Password strength policy (doc/PLAN §1.2): length + complexity + email-substring
// + HIBP breach check via k-anonymity. HIBP is stubbed here so the test is
// deterministic and offline — we assert on WHAT we send (only the 5-char prefix)
// and how a hit/miss/outage is handled (fail-open).
const policy = require("../../src/shared/security/password-policy");

const reject = async (pw, ctx) => {
  await expect(policy.assertStrongPassword(pw, ctx)).rejects.toMatchObject({
    status: 422,
  });
};

describe("assertStrongPassword — complexity rules", () => {
  beforeEach(() => {
    // Default: HIBP says "not breached" so complexity is what's under test.
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "ABCDE:0\n" });
  });
  afterEach(() => {
    delete global.fetch;
  });

  test("rejects too-short", () => reject("Ab1!xxxx")); // < 12
  test("rejects missing uppercase", () => reject("abcdefgh123!"));
  test("rejects missing lowercase", () => reject("ABCDEFGH123!"));
  test("rejects missing digit", () => reject("Abcdefghij!!"));
  test("rejects missing symbol", () => reject("Abcdefghij12"));
  test("rejects password containing the email local-part", () =>
    reject("Markkelvin99!!", { email: "markkelvin@example.com" }));

  test("accepts a strong password", async () => {
    await expect(
      policy.assertStrongPassword("Zt9$vQ2m!pLwR", { email: "a@b.com" }),
    ).resolves.toMatchObject({ breachChecked: true });
  });
});

describe("assertStrongPassword — HIBP breach check (k-anonymity)", () => {
  afterEach(() => {
    delete global.fetch;
  });

  test("sends ONLY the 5-char SHA-1 prefix, never the full hash", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "0000:0\n" });
    global.fetch = fetchMock;
    await policy.assertStrongPassword("Zt9$vQ2m!pLwR");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toMatch(
      /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/,
    );
  });

  test("rejects a password whose suffix appears in the HIBP range", async () => {
    const crypto = require("crypto");
    const pw = "Zt9$vQ2m!pLwR";
    const suffix = crypto
      .createHash("sha1")
      .update(pw)
      .digest("hex")
      .toUpperCase()
      .slice(5);
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => `${suffix}:42\n` });
    await expect(policy.assertStrongPassword(pw)).rejects.toMatchObject({
      code: "BREACHED_PASSWORD",
    });
  });

  test("fails OPEN when HIBP is unreachable (outage must not block reset)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    await expect(
      policy.assertStrongPassword("Zt9$vQ2m!pLwR"),
    ).resolves.toMatchObject({ breachChecked: false });
  });
});
