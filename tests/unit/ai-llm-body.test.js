"use strict";
/**
 * The LLM request body carries an output ceiling and asks for stream usage.
 *
 * B1: without `max_tokens` the vendor's default caps the reply mid-sentence.
 * B4: without `stream_options.include_usage` a streamed turn reports no token
 * usage and the budget ledger under-counts. Both are asserted at the wire.
 */

jest.mock("axios");
// Force the env-fallback vendor path (no platform DB in a unit test) so
// resolveVendor returns a usable deepseek config from a mocked platform service.
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn(async () => ({
    vendor: "deepseek",
    api_key: "test-key",
    endpoint_url: "https://vendor.example/v1",
    model: "test-model",
    is_active: true,
  })),
}));

const axios = require("axios");
const { config } = require("../../src/config/env");
const llm = require("../../src/services/ai/llm.service");

async function* fakeSseStream(chunks) {
  for (const c of chunks) yield Buffer.from(c);
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("non-streaming chat sends an explicit max_tokens (audit B1)", async () => {
  axios.post.mockResolvedValue({
    data: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  });
  await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
  const body = axios.post.mock.calls[0][1];
  expect(body.max_tokens).toBeGreaterThan(0);
});

test("streaming chat asks for usage and sets max_tokens (audit B1 + B4)", async () => {
  axios.post.mockResolvedValue({ data: fakeSseStream(["data: [DONE]\n\n"]) });
  const gen = llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }] });
  // Drain the generator so the request is actually issued.
  // eslint-disable-next-line no-unused-vars, no-empty
  for await (const _ of gen) { /* consume */ }
  const body = axios.post.mock.calls[0][1];
  expect(body.stream).toBe(true);
  expect(body.stream_options).toEqual({ include_usage: true });
  expect(body.max_tokens).toBeGreaterThan(0);
});

test("non-streaming chat uses the configurable, generous timeout (audit E1)", async () => {
  axios.post.mockResolvedValue({
    data: { choices: [{ message: { content: "ok" } }], usage: {} },
  });
  await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
  const axiosConfig = axios.post.mock.calls[0][2];
  expect(axiosConfig.timeout).toBe(config.AI_REQUEST_TIMEOUT_MS);
  // No longer the old baked-in 60s cap that tripped multi-hop chains.
  expect(axiosConfig.timeout).toBeGreaterThan(60000);
});

test("streaming chat uses the configurable stream timeout (audit E1)", async () => {
  axios.post.mockResolvedValue({ data: fakeSseStream(["data: [DONE]\n\n"]) });
  const gen = llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }] });
  // eslint-disable-next-line no-unused-vars, no-empty
  for await (const _ of gen) { /* consume */ }
  const axiosConfig = axios.post.mock.calls[0][2];
  expect(axiosConfig.timeout).toBe(config.AI_STREAM_TIMEOUT_MS);
  expect(axiosConfig.responseType).toBe("stream");
});
