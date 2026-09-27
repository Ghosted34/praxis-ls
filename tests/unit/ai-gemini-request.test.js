"use strict";
/**
 * What goes over the wire when Gemini answers — the two things DeepSeek never
 * needed and that only surface once Gemini is made primary in the console:
 *
 *   · thinking OFF for 2.5 Flash (`reasoning_effort: "none"`), because thinking
 *     tokens count against `max_tokens` and truncate long replies; "low" for
 *     models that cannot turn it off (they reject "none");
 *   · tool schemas reduced to Gemini's OpenAPI subset — `exclusiveMinimum`
 *     and uuid/email/date `format`s fail the whole request otherwise.
 *
 * And that DeepSeek's body is unchanged by either.
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
const llm = require("../../src/services/ai/llm.service");

const ok = { data: { choices: [{ message: { content: "ok" } }], usage: {} } };

const TOOL = {
  type: "function",
  function: {
    name: "draft_purchase_order",
    description: "Draft a PO",
    parameters: {
      type: "object",
      properties: {
        supplier_id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        due: { type: "string", format: "date-time" },
        qty: { type: "number", exclusiveMinimum: 0 },
        // a PROPERTY named like a keyword must survive
        format: { type: "string", enum: ["pdf", "xlsx"] },
        lines: { type: "array", items: { type: "object", properties: { amount: { type: "number", exclusiveMinimum: 0, maximum: 10 } } } },
      },
      required: ["supplier_id"],
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  platformVendors.getConfig.mockResolvedValue(null);
  axios.post.mockResolvedValue(ok);
});

describe("Gemini as primary — request body", () => {
  beforeEach(() => platformVendors.getChatPrimary.mockResolvedValue("gemini"));

  test("2.5 Flash is sent with thinking off, so max_tokens is spent on the answer", async () => {
    await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    const body = axios.post.mock.calls[0][1];
    expect(axios.post.mock.calls[0][0]).toMatch(/v1beta\/openai\/chat\/completions$/);
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.reasoning_effort).toBe("none");
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  test("a model that cannot disable thinking gets 'low', never the rejected 'none'", async () => {
    platformVendors.getConfig.mockImplementation(async (v) => (v === "gemini"
      ? { vendor: "gemini", api_key: "k", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro", is_active: true }
      : null));
    await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe("low");
  });

  test("tool schemas are reduced to Gemini's subset without losing properties", async () => {
    await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }], tools: [TOOL] });
    const p = axios.post.mock.calls[0][1].tools[0].function.parameters;
    expect(p.properties.supplier_id).toEqual({ type: "string" });
    expect(p.properties.email).toEqual({ type: "string" });
    expect(p.properties.due).toEqual({ type: "string", format: "date-time" });
    expect(p.properties.qty).toEqual({ type: "number", minimum: 0 });
    expect(p.properties.format).toEqual({ type: "string", enum: ["pdf", "xlsx"] });
    expect(p.properties.lines.items.properties.amount).toEqual({ type: "number", minimum: 0, maximum: 10 });
    expect(p.required).toEqual(["supplier_id"]);
    expect(JSON.stringify(p)).not.toMatch(/exclusiveMinimum|"format":"(uuid|email)"/);
    // the caller's tool object is not mutated (it is reused for the fallback)
    expect(TOOL.function.parameters.properties.qty.exclusiveMinimum).toBe(0);
  });

  test("the streaming path carries the same shaping", async () => {
    axios.post.mockRejectedValue(new Error("no stream")); // stream fails → non-stream fallback also rejected
    const it = llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }], tools: [TOOL] });
    try { for await (const chunk of it) void chunk; } catch { /* chain exhausted is fine here */ }
    const body = axios.post.mock.calls[0][1];
    expect(body.stream).toBe(true);
    expect(body.reasoning_effort).toBe("none");
    expect(JSON.stringify(body.tools)).not.toMatch(/exclusiveMinimum/);
  });
});

describe("DeepSeek is unaffected", () => {
  test("no reasoning_effort and the tool schema goes through verbatim", async () => {
    platformVendors.getChatPrimary.mockResolvedValue(null);
    await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }], tools: [TOOL] });
    const body = axios.post.mock.calls[0][1];
    expect(axios.post.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.tools[0]).toBe(TOOL);
  });
});
