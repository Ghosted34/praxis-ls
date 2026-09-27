"use strict";
/**
 * Gemini as the call pipeline's second transcription provider (owner decision
 * A-1): one request per part, verbatim in the language spoken, the language
 * reported, temperature 0, strict JSON.
 *
 * Browsers record audio/webm (Opus). The Gemini Developer API does not accept
 * it (its audio types are wav, mp3, aiff, aac, ogg-vorbis and flac; webm is a
 * Vertex-only type), so the service converts on the server with ffmpeg, which
 * the Docker image installs. The conversion is proved on a REAL recording:
 * `tests/fixtures/audio/chrome-opus-3s.webm` was produced by Chromium's own
 * MediaRecorder (`audio/webm;codecs=opus`), the recorder the call screen uses.
 * The fake Gemini below refuses webm the way the real one does, so a request
 * that skipped the conversion cannot pass.
 */
jest.mock("axios");
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn(async () => null) }));

process.env.GEMINI_API_KEY = "gem-test-key";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const axios = require("axios");
const platformVendors = require("../../src/services/platform/ai-vendor.service");
const { logger } = require("../../src/config/logger");
const gemini = require("../../src/services/ai/gemini-transcription.service");

const FIXTURES = path.join(__dirname, "..", "fixtures", "audio");
const WEBM = fs.readFileSync(path.join(FIXTURES, "chrome-opus-3s.webm"));
const HEADERLESS = fs.readFileSync(path.join(FIXTURES, "chrome-opus-headerless.webm"));

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
// CI installs ffmpeg for exactly this suite, so there a missing binary is a
// failure rather than a skip. A laptop without it skips the conversion tests.
const withFfmpeg = HAS_FFMPEG || process.env.CI ? describe : describe.skip;

const GEMINI_ACCEPTS = new Set(["audio/wav", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"]);

/** A Gemini that behaves like the real endpoint for the parts we depend on. */
function fakeGemini(reply = { text: "Bonjour, la livraison est prête.", language: "fr" }) {
  axios.post.mockImplementation(async (url, body) => {
    const inline = body.contents[0].parts.find((p) => p.inlineData).inlineData;
    if (!GEMINI_ACCEPTS.has(inline.mimeType)) {
      const err = new Error("Request failed with status code 400");
      err.response = { status: 400, data: { error: { message: `Unsupported MIME type: ${inline.mimeType}` } } };
      throw err;
    }
    return {
      data: {
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: typeof reply === "string" ? reply : JSON.stringify(reply) }] },
        }],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 20,
          promptTokensDetails: [{ modality: "TEXT", tokenCount: 24 }, { modality: "AUDIO", tokenCount: 96 }],
        },
      },
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockReset();
  platformVendors.getConfig.mockResolvedValue(null);
  jest.spyOn(logger, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

withFfmpeg("browser WebM is converted before it reaches Gemini", () => {
  test("the real Chrome WebM/Opus recording converts to FLAC", async () => {
    const out = await gemini.toGeminiAudio({ audio: WEBM, mimeType: "audio/webm;codecs=opus" });
    expect(out.mimeType).toBe("audio/flac");
    expect(out.data.subarray(0, 4).toString("latin1")).toBe("fLaC");
    expect(out.data.length).toBeGreaterThan(1000);
  });

  test("a transcription of that recording sends FLAC, and the fake Gemini accepts it", async () => {
    fakeGemini();
    const out = await gemini.transcribe({ audio: WEBM, mimeType: "audio/webm" });
    expect(out).toEqual(expect.objectContaining({
      text: "Bonjour, la livraison est prête.",
      detected_language: "fr",
      provider: "gemini",
    }));
    // 96 audio tokens at Gemini's 32 tokens per second.
    expect(out.audio_seconds).toBe(3);
    const [, body] = axios.post.mock.calls[0];
    const inline = body.contents[0].parts.find((p) => p.inlineData).inlineData;
    expect(inline.mimeType).toBe("audio/flac");
    expect(Buffer.from(inline.data, "base64").subarray(0, 4).toString("latin1")).toBe("fLaC");
  });

  test("the fake refuses webm, so skipping the conversion could not have passed", async () => {
    fakeGemini();
    await expect(axios.post("x", {
      contents: [{ parts: [{ inlineData: { mimeType: "audio/webm", data: WEBM.toString("base64") } }] }],
    })).rejects.toMatchObject({ response: { status: 400 } });
  });

  test("a headerless WebM part (what the current recorder uploads after part 1) fails in conversion and never reaches Gemini", async () => {
    fakeGemini();
    await expect(gemini.transcribe({ audio: HEADERLESS, mimeType: "audio/webm" })).rejects.toThrow(/convert/i);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("the request contract", () => {
  const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(40)]);

  test("types Gemini accepts are sent as they are, with no conversion", async () => {
    fakeGemini();
    await gemini.transcribe({ audio: WAV, mimeType: "audio/x-wav" });
    const inline = axios.post.mock.calls[0][1].contents[0].parts.find((p) => p.inlineData).inlineData;
    expect(inline.mimeType).toBe("audio/wav");
    expect(Buffer.from(inline.data, "base64").equals(WAV)).toBe(true);
  });

  test("native generateContent on the credential's host, key in a header, temperature 0, strict JSON", async () => {
    fakeGemini({ text: "Deliver on Friday.", language: "en" });
    await gemini.transcribe({ audio: WAV, mimeType: "audio/wav" });
    const [url, body, opts] = axios.post.mock.calls[0];
    // The env credential points at the OpenAI-compat gateway; audio goes to the
    // native API on the same host and version.
    expect(url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/);
    expect(url).not.toContain("/openai");
    expect(url).not.toContain("key=");
    expect(opts.headers["x-goog-api-key"]).toBe("gem-test-key");
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.properties.language.enum).toEqual(["en", "fr"]);
    expect(body.generationConfig.responseSchema.required).toEqual(["text", "language"]);
  });

  test("the instructions demand verbatim words in the language spoken, never a translation", async () => {
    fakeGemini();
    await gemini.transcribe({ audio: WAV, mimeType: "audio/wav" });
    const system = axios.post.mock.calls[0][1].systemInstruction.parts[0].text;
    expect(system).toMatch(/verbatim/i);
    expect(system).toMatch(/never translate/i);
    expect(system).toMatch(/"en" or "fr"/);
  });

  test("a platform credential is used over the env one, and a models/ prefix is tolerated", async () => {
    platformVendors.getConfig.mockResolvedValue({
      vendor: "gemini", api_key: "platform-key", model: "models/gemini-2.5-flash",
      endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai/", is_active: true,
    });
    fakeGemini();
    await gemini.transcribe({ audio: WAV, mimeType: "audio/wav" });
    const [url, , opts] = axios.post.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(opts.headers["x-goog-api-key"]).toBe("platform-key");
  });

  test("a reply that is not the JSON contract is a failure, not a transcript", async () => {
    fakeGemini("Here is the transcript: hello");
    await expect(gemini.transcribe({ audio: WAV, mimeType: "audio/wav" })).rejects.toThrow(/JSON/);
    fakeGemini({ text: "hello" });
    await expect(gemini.transcribe({ audio: WAV, mimeType: "audio/wav" })).rejects.toThrow(/contract/);
  });

  test("a blocked or truncated reply is a failure", async () => {
    axios.post.mockResolvedValue({ data: { promptFeedback: { blockReason: "SAFETY" }, candidates: [] } });
    await expect(gemini.transcribe({ audio: WAV, mimeType: "audio/wav" })).rejects.toThrow(/SAFETY/);
    axios.post.mockResolvedValue({
      data: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{\"text\": \"hel" }] } }] },
    });
    await expect(gemini.transcribe({ audio: WAV, mimeType: "audio/wav" })).rejects.toThrow(/MAX_TOKENS/);
  });

  test("no credential at all is a clear error", async () => {
    const saved = process.env.GEMINI_API_KEY;
    jest.resetModules();
    process.env.GEMINI_API_KEY = "";
    jest.doMock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn(async () => null) }));
    const fresh = require("../../src/services/ai/gemini-transcription.service");
    await expect(fresh.transcribe({ audio: WAV, mimeType: "audio/wav" })).rejects.toThrow(/not configured/i);
    process.env.GEMINI_API_KEY = saved;
  });
});
