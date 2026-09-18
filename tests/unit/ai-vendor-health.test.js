"use strict";
/**
 * Audit B2 — the startup health check that makes a vendor misconfig VISIBLE
 * instead of silent. It reports resolution only (no external call) so it is safe
 * to run at boot, and flags the three ways the chat chain is silently broken:
 * a vendor that does not resolve, a "gemini" pointed at its NATIVE (non-compat)
 * endpoint, and a primary that equals the fallback.
 *
 * DEEPSEEK_API_KEY is set so the primary resolves via .env; GEMINI_API_KEY is
 * deliberately left blank (the jest harness default) so the fallback is
 * unconfigured unless a test hands it a platform credential.
 */
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn(async () => null) }));

process.env.DEEPSEEK_API_KEY = "ds-test-key";
// GEMINI_API_KEY intentionally not set here.

const platformVendors = require("../../src/services/platform/ai-vendor.service");
const llm = require("../../src/services/ai/llm.service");

beforeEach(() => {
  jest.clearAllMocks();
  platformVendors.getConfig.mockResolvedValue(null);
});

test("flags an unconfigured fallback loudly (ok:false, primary still resolves)", async () => {
  const health = await llm.checkVendorHealth();
  expect(health.ok).toBe(false);
  expect(health.primary.resolved).toBe(true); // deepseek via .env
  expect(health.fallback.resolved).toBe(false); // gemini has no key anywhere
  expect(health.fallback.lookupError).toBe(false); // a definite "not configured", not a DB hiccup
  expect(health.issues.join(" ")).toMatch(/fallback chat vendor "gemini" is not configured/);
});

test("is OK when both PRIMARY and FALLBACK resolve to a compatible provider", async () => {
  platformVendors.getConfig.mockImplementation(async (v) => {
    if (v === "deepseek") return { vendor: "deepseek", api_key: "d", endpoint_url: "https://api.deepseek.com", model: "deepseek-chat", is_active: true };
    if (v === "gemini") return { vendor: "gemini", api_key: "g", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-pro", is_active: true };
    return null;
  });
  const health = await llm.checkVendorHealth();
  expect(health.ok).toBe(true);
  expect(health.issues).toEqual([]);
  expect(health.primary.name).toBe("deepseek");
  expect(health.fallback.name).toBe("gemini");
  expect(health.fallback.openaiCompatible).toBe(true);
});

test("flags a 'gemini' pointed at the NATIVE (non-/chat/completions) endpoint", async () => {
  platformVendors.getConfig.mockImplementation(async (v) =>
    v === "gemini"
      ? { vendor: "gemini", api_key: "g", endpoint_url: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-pro", is_active: true }
      : null,
  );
  const health = await llm.checkVendorHealth();
  expect(health.ok).toBe(false);
  expect(health.fallback.resolved).toBe(true);
  expect(health.fallback.openaiCompatible).toBe(false);
  expect(health.issues.join(" ")).toMatch(/native/i);
});

test("a look-alike host is NOT mis-flagged as native Gemini (CodeQL: exact host match)", async () => {
  // ...googleapis.com.evil.com is a DIFFERENT host — the native-endpoint check
  // must match the parsed hostname exactly, not a substring of the URL.
  platformVendors.getConfig.mockImplementation(async (v) =>
    v === "gemini"
      ? { vendor: "gemini", api_key: "g", endpoint_url: "https://generativelanguage.googleapis.com.evil.com/v1beta", model: "gemini-1.5-pro", is_active: true }
      : null,
  );
  const health = await llm.checkVendorHealth();
  // Not the real Gemini host, so it is not flagged as the native API.
  expect(health.fallback.openaiCompatible).toBe(true);
  expect(health.issues.join(" ")).not.toMatch(/native/i);
});

test("an unreadable platform DB leaves the check inconclusive, not a false alarm", async () => {
  // getConfig throws (DB down at boot) and there is no .env fallback for gemini,
  // so its non-resolution must be reported as inconclusive rather than a
  // definite misconfig.
  platformVendors.getConfig.mockImplementation(async (v) => {
    if (v === "deepseek") return { vendor: "deepseek", api_key: "d", endpoint_url: "https://api.deepseek.com", model: "deepseek-chat", is_active: true };
    throw new Error("platform DB unreachable");
  });
  const health = await llm.checkVendorHealth();
  expect(health.fallback.resolved).toBe(false);
  expect(health.fallback.lookupError).toBe(true);
  expect(health.inconclusive).toBe(true);
  expect(health.ok).toBe(true); // no DEFINITE problem to assert
});
