"use strict";

const tokens = require("../../src/services/signatures/tokens");
const { maskIp, coarseUserAgent } = require("../../src/services/signatures/mask");

const PEPPER = "x".repeat(48);

describe("verify code — the public credential", () => {
  test("is 12 Crockford characters, with no I, L, O or U", () => {
    for (let i = 0; i < 200; i += 1) {
      const c = tokens.mintVerifyCode();
      expect(c).toHaveLength(12);
      expect(c).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{12}$/);
    }
  });

  test("does not repeat across a large sample", () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i += 1) seen.add(tokens.mintVerifyCode());
    expect(seen.size).toBe(5000);
  });

  test("accepts what a human actually types down a phone line", () => {
    // Lower case, Crockford confusables, and whatever separator they chose.
    // A verification code must not fail because someone typed a space.
    expect(tokens.normaliseCode(" a4b7-k92m xq1p ")).toBe("A4B7K92MXQ1P");
    expect(tokens.normaliseCode("A4B7.K92M.XQ1P")).toBe("A4B7K92MXQ1P");
    expect(tokens.normaliseCode("IOL")).toBe("101"); // I→1, O→0, L→1
    expect(tokens.normaliseCode("U")).toBe("V");
  });

  test("formats for print in groups of four, and round-trips", () => {
    const c = tokens.mintVerifyCode();
    expect(tokens.formatCode(c)).toMatch(/^.{4}-.{4}-.{4}$/);
    expect(tokens.normaliseCode(tokens.formatCode(c))).toBe(c);
  });

  test("rejects the wrong length and out-of-alphabet input", () => {
    expect(tokens.isValidCode("A4B7K92MXQ1")).toBe(false);
    expect(tokens.isValidCode("A4B7K92MXQ1PP")).toBe(false);
    expect(tokens.isValidCode("")).toBe(false);
    expect(tokens.isValidCode(null)).toBe(false);
  });

  test("builds the short verify URL the QR encodes", () => {
    // The /v/ path is a legibility decision: it keeps the QR at 33 modules
    // rather than 45, which is 0.67mm per module instead of 0.49mm at 22mm.
    expect(tokens.verifyUrl("A4B7K92MXQ1P", "https://smartlogistics.cm/"))
      .toBe("https://smartlogistics.cm/v/A4B7K92MXQ1P");
    expect(tokens.verifyUrl("a4b7-k92m-xq1p", "https://smartlogistics.cm"))
      .toBe("https://smartlogistics.cm/v/A4B7K92MXQ1P");
  });
});

describe("sign token — the credential that grants action", () => {
  const OLD = process.env.SIGNATURE_TOKEN_PEPPER;
  const OLD_PREV = process.env.SIGNATURE_TOKEN_PEPPER_PREVIOUS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.SIGNATURE_TOKEN_PEPPER;
    else process.env.SIGNATURE_TOKEN_PEPPER = OLD;
    if (OLD_PREV === undefined) delete process.env.SIGNATURE_TOKEN_PEPPER_PREVIOUS;
    else process.env.SIGNATURE_TOKEN_PEPPER_PREVIOUS = OLD_PREV;
  });

  test("mints a plaintext token and a peppered HMAC that match on lookup", () => {
    process.env.SIGNATURE_TOKEN_PEPPER = PEPPER;
    const { token, hmac } = tokens.mintSignToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.signTokenCandidates(token)).toContain(hmac);
  });

  test("a DIFFERENT pepper does not match — this is the whole point", () => {
    process.env.SIGNATURE_TOKEN_PEPPER = PEPPER;
    const { token, hmac } = tokens.mintSignToken();
    process.env.SIGNATURE_TOKEN_PEPPER = "y".repeat(48);
    expect(tokens.signTokenCandidates(token)).not.toContain(hmac);
  });

  test("rotation offers both peppers so in-flight links survive the deploy", () => {
    process.env.SIGNATURE_TOKEN_PEPPER = PEPPER;
    const { token, hmac } = tokens.mintSignToken();
    process.env.SIGNATURE_TOKEN_PEPPER = "y".repeat(48);
    process.env.SIGNATURE_TOKEN_PEPPER_PREVIOUS = PEPPER;
    const candidates = tokens.signTokenCandidates(token);
    expect(candidates).toHaveLength(2);
    expect(candidates).toContain(hmac);
  });

  test("refuses to mint without a pepper, rather than minting an unpeppered row", () => {
    delete process.env.SIGNATURE_TOKEN_PEPPER;
    expect(() => tokens.mintSignToken()).toThrow(/SIGNATURE_TOKEN_PEPPER/);
    process.env.SIGNATURE_TOKEN_PEPPER = "tooshort";
    expect(() => tokens.mintSignToken()).toThrow(/32 characters/);
  });
});

describe("IP masking — §3.13", () => {
  test("keeps two octets of IPv4 and nothing more", () => {
    expect(maskIp("197.210.44.12")).toBe("197.210.***.***");
    expect(maskIp("10.0.0.1")).toBe("10.0.***.***");
  });

  test("unwraps the ::ffff: form Node hands back on dual-stack sockets", () => {
    expect(maskIp("::ffff:197.210.44.12")).toBe("197.210.***.***");
  });

  test("keeps two hextets of IPv6", () => {
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:***");
  });

  test("never echoes an unparseable input — a masker that falls through is not a masker", () => {
    expect(maskIp("nonsense")).toBe("***");
    expect(maskIp("999.999.999.999")).toBe("***");
    expect(maskIp("")).toBe("");
    expect(maskIp(null)).toBe("");
  });

  test("coarsens the user agent to a device shape, not a fingerprint", () => {
    expect(coarseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari")).toBe("Mobile browser");
    expect(coarseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120")).toBe("Desktop browser");
    expect(coarseUserAgent("curl/8.4.0")).toBe("Automated client");
    expect(coarseUserAgent("")).toBe("Unknown device");
    // The raw string never survives.
    expect(coarseUserAgent("Mozilla/5.0 (iPhone) Safari")).not.toMatch(/Mozilla/);
  });
});
