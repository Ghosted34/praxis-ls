"use strict";
/**
 * Calls audit N3. The Gemini model defaults named retired models, which answer
 * every request with 404 and take out the call transcription fallback (O1),
 * the call summary (O2) and document vision whenever the platform credential
 * is missing or unreadable. The defaults now name gemini-2.5-flash (the model
 * the platform credential uses), and a check reports when the configured model
 * does not exist: logged at boot, shown on the console's AI providers screen.
 */
const fs = require("fs");
const path = require("path");

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../src/services/ai/llm.service", () => ({ resolveVendor: jest.fn() }));
jest.mock("../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const axios = require("axios");
const { resolveVendor } = require("../../src/services/ai/llm.service");
const { logger } = require("../../src/config/logger");
const check = require("../../src/services/ai/gemini-model-check.service");

const ROOT = path.join(__dirname, "..", "..");
const vendor = (model = "gemini-2.5-flash") => ({
  vendor: "gemini", api_key: "k", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai", model,
});

beforeEach(() => {
  jest.clearAllMocks();
  check.resetCache();
});

describe("the defaults (N3)", () => {
  test("GEMINI_MODEL defaults to gemini-2.5-flash", () => {
    const saved = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    jest.isolateModules(() => {
      const { config } = jest.requireActual("../../src/config/env");
      expect(config.GEMINI_MODEL).toBe("gemini-2.5-flash");
    });
    if (saved !== undefined) process.env.GEMINI_MODEL = saved;
  });

  test.each([
    "src/config/env.js",
    "src/services/ai/vision.service.js",
    "client/src/features/ai-control/pages.tsx",
  ])("%s names no retired 1.x Gemini model", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(text).not.toMatch(/gemini-1\.\d/);
    expect(text).toMatch(/gemini-2\.5-flash/);
  });
});

describe("checkGeminiModel", () => {
  test("asks Google's native models endpoint about exactly the configured id", async () => {
    resolveVendor.mockResolvedValue(vendor("models/gemini-2.5-flash"));
    axios.get.mockResolvedValue({ data: { displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] } });
    const out = await check.checkGeminiModel();
    expect(out).toEqual(expect.objectContaining({ status: "ok", model: "gemini-2.5-flash", detail: "Gemini 2.5 Flash" }));
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash");
    expect(opts.headers["x-goog-api-key"]).toBe("k");
  });

  test("a 404 is a missing model", async () => {
    resolveVendor.mockResolvedValue(vendor("gemini-1.5-pro"));
    axios.get.mockRejectedValue(Object.assign(new Error("404"), {
      response: { status: 404, data: { error: { message: "models/gemini-1.5-pro is not found for API version v1beta" } } },
    }));
    const out = await check.checkGeminiModel();
    expect(out).toEqual(expect.objectContaining({ status: "missing", model: "gemini-1.5-pro", http_status: 404 }));
    expect(out.detail).toMatch(/not found/);
  });

  test("a model that cannot generate content is unusable; no credential is unconfigured; anything else is an error", async () => {
    resolveVendor.mockResolvedValue(vendor("text-embedding-004"));
    axios.get.mockResolvedValue({ data: { supportedGenerationMethods: ["embedContent"] } });
    expect((await check.checkGeminiModel({ force: true })).status).toBe("unusable");
    resolveVendor.mockResolvedValue(null);
    expect((await check.checkGeminiModel({ force: true })).status).toBe("unconfigured");
    resolveVendor.mockResolvedValue(vendor());
    axios.get.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403, data: {} } }));
    expect(await check.checkGeminiModel({ force: true })).toEqual(expect.objectContaining({ status: "error", http_status: 403 }));
  });

  test("the answer is kept for ten minutes, so the console screen does not call Google on every load", async () => {
    resolveVendor.mockResolvedValue(vendor());
    axios.get.mockResolvedValue({ data: { supportedGenerationMethods: ["generateContent"] } });
    await check.checkGeminiModel();
    await check.checkGeminiModel();
    expect(axios.get).toHaveBeenCalledTimes(1);
    await check.checkGeminiModel({ force: true });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test("at boot, a missing model is logged at ERROR, naming the model and where to fix it", async () => {
    resolveVendor.mockResolvedValue(vendor("gemini-1.5-pro"));
    axios.get.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404, data: {} } }));
    await check.logGeminiModelAtBoot();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatch(/GEMINI MODEL "gemini-1\.5-pro" IS NOT AVAILABLE/);
    expect(logger.error.mock.calls[0][1]).toMatch(/AI providers/);
  });

  test("the console can read it: GET /platform/ai-vendors/gemini/model-check", () => {
    const routes = fs.readFileSync(path.join(ROOT, "src/modules/platform/platform.routes.js"), "utf8");
    expect(routes).toMatch(/router\.get\("\/ai-vendors\/gemini\/model-check", requireCap\("settings\.read"\), c\.aiGeminiModelCheck\)/);
  });
});
