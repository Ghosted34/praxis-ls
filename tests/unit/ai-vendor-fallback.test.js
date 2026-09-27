"use strict";
/**
 * Audit B2 — the fallback vendor must actually resolve and answer.
 *
 * Before this fix FALLBACK="gemini" was not in ENV_VENDORS and Gemini's native
 * API is not /chat/completions-shaped, so resolveVendor("gemini") returned null
 * and ANY primary failure degraded to the stub. These pin that:
 *   · "gemini" now resolves (to the OpenAI-compat gateway) via the .env fallback,
 *   · a primary CONFIGURATION error (a killed key) degrades to the WORKING
 *     fallback, not the stub, while still logging loudly,
 *   · prompt-cache hints (B5) are honoured per vendor and never leak to the wire.
 *
 * The env keys are set BEFORE requiring the service because ENV_VENDORS is built
 * once at module load from `config`. The platform lookup is mocked to null so the
 * .env path is exercised deterministically.
 */
jest.mock("axios");
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn(async () => null),
  getChatPrimary: jest.fn(async () => null),
}));

process.env.DEEPSEEK_API_KEY = "ds-test-key";
process.env.GEMINI_API_KEY = "gem-test-key";

const axios = require("axios");
const platformVendors = require("../../src/services/platform/ai-vendor.service");
const { logger } = require("../../src/config/logger");
const llm = require("../../src/services/ai/llm.service");

const completion = (content, model) => ({
  data: { choices: [{ message: { content } }], model, usage: { prompt_tokens: 1, completion_tokens: 1 } },
});

beforeEach(() => {
  jest.clearAllMocks();
  platformVendors.getConfig.mockResolvedValue(null); // force the .env fallback path
  platformVendors.getChatPrimary.mockResolvedValue(null); // nothing flagged → default chain
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the platform's primary choice is what a call actually walks", () => {
  test("with 'gemini' flagged primary the FIRST request goes to Gemini's gateway and deepseek is the fallback", async () => {
    platformVendors.getChatPrimary.mockResolvedValue("gemini");
    axios.post
      .mockRejectedValueOnce({ response: { status: 503 } }) // gemini (now primary) → transient
      .mockResolvedValueOnce(completion("Answer from deepseek, now the fallback.", "deepseek-chat"));

    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });

    expect(axios.post.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(axios.post.mock.calls[1][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(res.provider).toBe("deepseek");
    expect(res.text).toBe("Answer from deepseek, now the fallback.");
    // The degraded turn is recorded against the vendor that answered, naming
    // the one tried before it — the health event does not assume deepseek is
    // always the primary.
    expect(res.health).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "fallback", provider: "deepseek", detail: { after: ["gemini"] } }),
    ]));
  });

  test("the choice is read PER CALL — a switch in the console takes effect on the next turn, no restart", async () => {
    axios.post.mockResolvedValue(completion("ok", "x"));
    platformVendors.getChatPrimary.mockResolvedValueOnce("deepseek");
    await llm.chat({ client: {}, messages: [{ role: "user", content: "1" }] });
    platformVendors.getChatPrimary.mockResolvedValueOnce("gemini");
    await llm.chat({ client: {}, messages: [{ role: "user", content: "2" }] });

    expect(axios.post.mock.calls[0][0]).toMatch(/^https:\/\/api\.deepseek\.com\//);
    expect(axios.post.mock.calls[1][0]).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
  });

  test("the same applies to the streaming path", async () => {
    platformVendors.getChatPrimary.mockResolvedValue("gemini");
    // No stream support in the mock → callVendorStream falls back to callVendor,
    // which is enough to see which vendor was tried first.
    axios.post.mockRejectedValueOnce(new Error("no stream")).mockResolvedValueOnce(completion("streamed", "gemini-2.5-flash"));
    const chunks = [];
    for await (const c of llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }] })) chunks.push(c);
    expect(axios.post.mock.calls[0][0]).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    expect(chunks[chunks.length - 1].provider).toBe("gemini");
  });
});

test("the fallback vendor 'gemini' now resolves to the OpenAI-compat gateway (audit B2)", async () => {
  const vendor = await llm.resolveVendor({}, "gemini");
  expect(vendor).not.toBeNull();
  expect(vendor.vendor).toBe("gemini");
  // The OpenAI-compat endpoint, never the native one.
  expect(vendor.endpoint_url).toContain("/openai");
  expect(vendor.endpoint_url).toContain("generativelanguage.googleapis.com");
});

test("a primary CONFIG error degrades to the working fallback, not the stub", async () => {
  // deepseek (primary) → 401 (killed key); gemini (fallback) → real answer.
  axios.post
    .mockRejectedValueOnce({ response: { status: 401 } })
    .mockResolvedValueOnce(completion("Answer from the fallback.", "gemini-1.5-pro"));

  const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });

  expect(res.text).toBe("Answer from the fallback.");
  expect(res.provider).toBe("gemini");
  expect(axios.post).toHaveBeenCalledTimes(2); // it actually tried the fallback
  expect(logger.error).toHaveBeenCalled(); // ...but loudly, so the misconfig is visible
});

test("when BOTH vendors have a config error the stub names the configuration problem", async () => {
  axios.post
    .mockRejectedValueOnce({ response: { status: 401 } })
    .mockRejectedValueOnce({ response: { status: 403 } });

  const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });

  expect(res.provider).toBeNull();
  expect(res.text).toMatch(/configuration error/i);
});

test("a transient primary error still falls back (unchanged), and the fallback answers", async () => {
  axios.post
    .mockRejectedValueOnce({ response: { status: 503 } }) // transient
    .mockResolvedValueOnce(completion("ok", "gemini-1.5-pro"));

  const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
  expect(res.text).toBe("ok");
  expect(res.provider).toBe("gemini");
});

describe("prompt caching (audit B5) — a cachePrefix hint is honoured per vendor and never sent raw", () => {
  const PREFIX = "STATIC RULES PREFIX. ";
  const TAIL = "\n\nCONTEXT:\n(dynamic)";
  const withPrefix = () => [
    { role: "system", content: PREFIX + TAIL, cachePrefix: PREFIX },
    { role: "user", content: "hi" },
  ];

  test("an AUTO vendor (deepseek) gets a plain string and the hint is stripped", async () => {
    axios.post.mockResolvedValue(completion("ok"));
    await llm.chat({ client: {}, messages: withPrefix() });
    const sent = axios.post.mock.calls[0][1].messages;
    expect(typeof sent[0].content).toBe("string");
    expect(sent[0].content).toBe(PREFIX + TAIL);
    expect(sent[0]).not.toHaveProperty("cachePrefix");
  });

  test("an EXPLICIT vendor (anthropic) gets a cache_control breakpoint on the static prefix", async () => {
    platformVendors.getConfig.mockImplementation(async (v) =>
      v === "anthropic"
        ? { vendor: "anthropic", api_key: "a", endpoint_url: "https://api.anthropic.com/v1", model: "claude", is_active: true }
        : null,
    );
    axios.post.mockResolvedValue(completion("ok"));

    await llm.chat({ client: {}, vendorName: "anthropic", messages: withPrefix() });

    const sent = axios.post.mock.calls[0][1].messages;
    expect(Array.isArray(sent[0].content)).toBe(true);
    expect(sent[0].content[0]).toEqual({ type: "text", text: PREFIX, cache_control: { type: "ephemeral" } });
    expect(sent[0].content[1]).toEqual({ type: "text", text: TAIL });
    expect(sent[0]).not.toHaveProperty("cachePrefix");
    // The non-prefixed user turn is untouched.
    expect(sent[1]).toEqual({ role: "user", content: "hi" });
  });
});

test("supportsPromptCache is true for the configured vendors and false for unknowns", () => {
  expect(llm.supportsPromptCache("deepseek")).toBe(true);
  expect(llm.supportsPromptCache("gemini")).toBe(true);
  expect(llm.supportsPromptCache("anthropic")).toBe(true);
  expect(llm.supportsPromptCache("some-unknown-vendor")).toBe(false);
});
