"use strict";

const mockCreate = jest.fn();
const mockGetConfig = jest.fn();

jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: mockGetConfig }));
jest.mock("../../src/config/env", () => ({
  config: { GROQ_API_KEY: "", WHISPER_BASE_URL: "" },
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn() },
}));
jest.mock("openai", () => {
  function OpenAI(options) {
    OpenAI.options = options;
    return { audio: { ["transcriptions"]: { create: mockCreate } } };
  }
  OpenAI.toFile = jest.fn(async (buffer, name, options) => ({ buffer, name, ...options }));
  return OpenAI;
}, { virtual: true });

const OpenAI = require("openai");
const transcription = require("../../src/services/ai/transcription.service");

describe("shared transcription vendor resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ text: "Gate four is clear", duration: 2 });
    mockGetConfig.mockResolvedValue({
      vendor: "groq",
      api_key: "platform-key",
      endpoint_url: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3",
      is_active: true,
    });
  });

  test("uses the Groq row configured in Platform Console when the caller supplies no vendor", async () => {
    const result = await transcription.transcribe({
      audio: Buffer.from("audio"),
      mimeType: "audio/webm",
    });

    expect(mockGetConfig).toHaveBeenCalledWith("groq");
    expect(OpenAI.options).toEqual({
      apiKey: "platform-key",
      baseURL: "https://api.groq.com/openai/v1",
    });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "whisper-large-v3",
    }));
    expect(result.text).toBe("Gate four is clear");
  });

  test("does not repeat the lookup when a worker already supplied the vendor", async () => {
    await transcription.transcribe({
      audio: Buffer.from("audio"),
      vendor: {
        api_key: "worker-key",
        endpoint_url: "https://worker.example/v1",
        model: "whisper-worker",
        is_active: true,
      },
    });

    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(OpenAI.options.apiKey).toBe("worker-key");
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "whisper-worker" }));
  });
});
