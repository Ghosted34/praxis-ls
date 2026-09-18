"use strict";
/**
 * Audit E4 — embeddings are a silent grounding dependency: with no embeddings
 * vendor configured, retrieval returns no vectors and the assistant answers from
 * live tool reads alone, with nothing said. checkEmbeddingsHealth() makes that
 * legible (boot WARN + a future AI Control surface). Resolution-only, no call.
 *
 * The harness blanks OPENAI_API_KEY, so the .env fallback is off unless a test
 * hands a platform credential.
 */
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn(async () => null) }));

const platformVendors = require("../../src/services/platform/ai-vendor.service");
const embeddings = require("../../src/services/ai/embeddings.service");

beforeEach(() => {
  jest.clearAllMocks();
  platformVendors.getConfig.mockResolvedValue(null);
});

test("grounding is ENABLED when an embeddings vendor resolves", async () => {
  platformVendors.getConfig.mockResolvedValue({
    vendor: "embeddings", api_key: "k", endpoint_url: "https://api.openai.com/v1",
    model: "text-embedding-3-small", is_active: true,
  });
  const h = await embeddings.checkEmbeddingsHealth();
  expect(h.ok).toBe(true);
  expect(h.groundingEnabled).toBe(true);
  expect(h.model).toBe("text-embedding-3-small");
});

test("grounding is LIMITED (flagged) when no embeddings vendor resolves (audit E4)", async () => {
  const h = await embeddings.checkEmbeddingsHealth();
  expect(h.ok).toBe(false);
  expect(h.groundingEnabled).toBe(false);
});

test("an unreadable platform DB does not throw — it reports limited, best-effort", async () => {
  platformVendors.getConfig.mockRejectedValue(new Error("platform DB unreachable"));
  const h = await embeddings.checkEmbeddingsHealth();
  expect(h.groundingEnabled).toBe(false);
});
