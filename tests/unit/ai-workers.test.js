"use strict";
const aiTranscribe = require("../../src/jobs/handlers/ai-transcribe");
const aiVision = require("../../src/jobs/handlers/ai-vision");
const transcription = require("../../src/services/ai/transcription.service");
const vision = require("../../src/services/ai/vision.service");

describe("worker-ai handlers: input guards (no DB)", () => {
  test("ai-transcribe rejects missing job data before touching a tenant", async () => {
    await expect(aiTranscribe({ data: {} })).rejects.toThrow(/tenantMeta \+ user \+ audioBase64/);
  });
  test("ai-vision rejects missing job data", async () => {
    await expect(aiVision({ data: { tenantMeta: {}, user: { user_id: "u" } } })).rejects.toThrow(/imageBase64/);
  });
});

describe("provider services: validation", () => {
  test("transcribe rejects empty/absent audio or missing provider", async () => {
    await expect(transcription.transcribe({ audio: Buffer.alloc(0), vendor: { api_key: "x", endpoint_url: "http://y" } }))
      .rejects.toThrow(/non-empty audio Buffer/);
    await expect(transcription.transcribe({ audio: Buffer.from("hi"), vendor: null }))
      .rejects.toThrow(/not configured|audio Buffer/);
  });
  test("vision extract rejects empty image or missing provider", async () => {
    await expect(vision.extract({ image: Buffer.alloc(0), vendor: { api_key: "x" } }))
      .rejects.toThrow(/non-empty image Buffer/);
    await expect(vision.extract({ image: Buffer.from([1, 2, 3]), vendor: null }))
      .rejects.toThrow(/not configured|image Buffer/);
  });
});
