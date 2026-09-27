"use strict";
/**
 * `llm.chat`'s optional `fallbackVendor` (Smart Comms owner decision A-2).
 *
 * Call summaries go to Gemini first and use DeepSeek only as the last resort.
 * `vendorName: "gemini"` alone gave no DeepSeek hop at all, because the chain
 * was always `[vendorName, FALLBACK]` and FALLBACK is gemini. These pin both
 * halves: the summary order is gemini → deepseek, and every caller that does
 * not pass `fallbackVendor` keeps today's deepseek → gemini.
 */
jest.mock("axios");
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn(async () => null) }));

process.env.DEEPSEEK_API_KEY = "ds-test-key";
process.env.GEMINI_API_KEY = "gem-test-key";

const axios = require("axios");
const platformVendors = require("../../src/services/platform/ai-vendor.service");
const { logger } = require("../../src/config/logger");
const llm = require("../../src/services/ai/llm.service");

const completion = (content) => ({
  data: { choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
});
const hostOf = (call) => new URL(call[0]).hostname;

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockReset();
  platformVendors.getConfig.mockResolvedValue(null);
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("gemini first, deepseek as the fallback when the caller asks for it", async () => {
  axios.post
    .mockRejectedValueOnce({ response: { status: 503 } })
    .mockResolvedValueOnce(completion("from deepseek"));

  const res = await llm.chat({
    client: {}, messages: [{ role: "user", content: "hi" }],
    vendorName: "gemini", fallbackVendor: "deepseek",
  });

  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(hostOf(axios.post.mock.calls[0])).toBe("generativelanguage.googleapis.com");
  expect(hostOf(axios.post.mock.calls[1])).not.toBe("generativelanguage.googleapis.com");
  expect(res.provider).toBe("deepseek");
  expect(res.text).toBe("from deepseek");
});

test("gemini answering means deepseek is never called", async () => {
  axios.post.mockResolvedValueOnce(completion("from gemini"));
  const res = await llm.chat({
    client: {}, messages: [{ role: "user", content: "hi" }],
    vendorName: "gemini", fallbackVendor: "deepseek",
  });
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(res.provider).toBe("gemini");
});

test("every other caller keeps deepseek → gemini", async () => {
  axios.post
    .mockRejectedValueOnce({ response: { status: 503 } })
    .mockResolvedValueOnce(completion("from gemini"));

  const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });

  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(hostOf(axios.post.mock.calls[0])).not.toBe("generativelanguage.googleapis.com");
  expect(hostOf(axios.post.mock.calls[1])).toBe("generativelanguage.googleapis.com");
  expect(res.provider).toBe("gemini");
});

test("vendorName gemini with no fallbackVendor is still gemini alone (today's behaviour)", async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 503 } });
  const res = await llm.chat({
    client: {}, messages: [{ role: "user", content: "hi" }], vendorName: "gemini",
  });
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(res.provider).toBeNull();
});
