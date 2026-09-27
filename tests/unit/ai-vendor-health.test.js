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
 *
 * The primary is the PLATFORM'S choice now (`ai_vendor_credential.
 * is_chat_primary`, read through `getChatPrimary`). It is mocked to null — no
 * row flagged — so the default chain is what these run against unless a test
 * says otherwise; the "platform choice" block below is where it is exercised.
 */
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn(async () => null),
  getChatPrimary: jest.fn(async () => null),
}));

process.env.DEEPSEEK_API_KEY = "ds-test-key";
// GEMINI_API_KEY intentionally not set here.

const platformVendors = require("../../src/services/platform/ai-vendor.service");
const llm = require("../../src/services/ai/llm.service");

const bothConfigured = async (v) => {
  if (v === "deepseek") return { vendor: "deepseek", api_key: "d", endpoint_url: "https://api.deepseek.com", model: "deepseek-chat", is_active: true };
  if (v === "gemini") return { vendor: "gemini", api_key: "g", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", is_active: true };
  return null;
};

beforeEach(() => {
  jest.clearAllMocks();
  platformVendors.getConfig.mockResolvedValue(null);
  platformVendors.getChatPrimary.mockResolvedValue(null);
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
  platformVendors.getConfig.mockImplementation(bothConfigured);
  const health = await llm.checkVendorHealth();
  expect(health.ok).toBe(true);
  expect(health.issues).toEqual([]);
  expect(health.primary.name).toBe("deepseek");
  expect(health.fallback.name).toBe("gemini");
  expect(health.fallback.openaiCompatible).toBe(true);
  // Nothing flagged in the platform → the code default, and the check says so.
  expect(health.source).toBe("default");
  expect(health.chain).toEqual(["deepseek", "gemini"]);
});

describe("the platform's choice of primary (ai_vendor_credential.is_chat_primary)", () => {
  test("a flagged 'gemini' becomes the primary and deepseek the fallback — the chain SWAPS, it does not shrink", async () => {
    platformVendors.getConfig.mockImplementation(bothConfigured);
    platformVendors.getChatPrimary.mockResolvedValue("gemini");
    const health = await llm.checkVendorHealth();
    expect(health.ok).toBe(true);
    expect(health.chain).toEqual(["gemini", "deepseek"]);
    expect(health.primary.name).toBe("gemini");
    expect(health.fallback.name).toBe("deepseek");
    expect(health.distinct).toBe(true); // audit B2: always a distinct provider behind the primary
    expect(health.source).toBe("platform");
  });

  test("the same choice drives the runtime: resolveChain is what chat() walks", async () => {
    platformVendors.getChatPrimary.mockResolvedValue("gemini");
    expect(await llm.resolveChain()).toEqual({ chain: ["gemini", "deepseek"], source: "platform" });
    // singleVendor keeps only the head (the optional-summariser path).
    expect(await llm.resolveChain({ singleVendor: true })).toEqual({ chain: ["gemini"], source: "platform" });
  });

  test("choosing the default primary yields the default chain exactly", async () => {
    platformVendors.getChatPrimary.mockResolvedValue("deepseek");
    expect(await llm.resolveChain()).toEqual({ chain: ["deepseek", "gemini"], source: "platform" });
  });

  test("a flag on a vendor that cannot answer chat (groq) is ignored, not obeyed", async () => {
    // The service refuses to SET this; the runtime must not trust the column
    // regardless (a hand-edited row, an older service) — a voice vendor tried
    // first on every turn is a failed call before every answer.
    platformVendors.getChatPrimary.mockResolvedValue("groq");
    expect(await llm.resolveChain()).toEqual({ chain: ["deepseek", "gemini"], source: "default" });
  });

  test("an explicit vendorName outranks the platform choice, and keeps a fallback behind it", async () => {
    platformVendors.getChatPrimary.mockResolvedValue("gemini");
    expect(await llm.resolveChain({ vendorName: "deepseek" })).toEqual({ chain: ["deepseek", "gemini"], source: "explicit" });
    // A pinned vendor keeps the pre-console contract: [vendorName, fallback],
    // fallbackVendor defaulting to gemini (ai-llm-fallback-vendor.test.js).
    expect(await llm.resolveChain({ vendorName: "anthropic" })).toEqual({ chain: ["anthropic", "gemini"], source: "explicit" });
    expect(await llm.resolveChain({ vendorName: "gemini" })).toEqual({ chain: ["gemini"], source: "explicit" });
    expect(await llm.resolveChain({ vendorName: "gemini", fallbackVendor: "deepseek" })).toEqual({ chain: ["gemini", "deepseek"], source: "explicit" });
  });

  test("a preference lookup that throws (platform DB down) falls back to the default chain, and the turn is not lost", async () => {
    platformVendors.getConfig.mockImplementation(bothConfigured);
    platformVendors.getChatPrimary.mockRejectedValue(new Error("platform DB unreachable"));
    const health = await llm.checkVendorHealth();
    expect(health.chain).toEqual(["deepseek", "gemini"]);
    expect(health.source).toBe("default");
    expect(health.ok).toBe(true);
  });
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
