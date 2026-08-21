"use strict";
const aiTranscribe = require("../../src/jobs/handlers/ai-transcribe");
const transcription = require("../../src/services/ai/transcription.service");
const vision = require("../../src/services/ai/vision.service");

describe("worker-ai handlers: input guards (no DB)", () => {
  test("ai-transcribe rejects missing job data before touching a tenant", async () => {
    await expect(aiTranscribe({ data: {} })).rejects.toThrow(
      /tenantMeta \+ user \+ audioBase64/,
    );
  });
  /**
   * The `ai-vision` handler's guard test used to sit here.
   *
   * The handler is gone. It was registered in `workers.js` and enqueued by
   * nothing — a worker for an assistant image flow that has no route, no
   * validator and no upload control, so no job could ever reach it. The general
   * orphan sweep (tests/security/orphan-wiring-sweep.test.js) is what surfaced
   * it, and that sweep is now what stands in this test's place: it fails if any
   * registered worker has no producer, which is the defect this file could not
   * have caught however well it tested the handler's arguments.
   *
   * `vision.service` itself is untouched and still exercised below — the
   * capability has three live callers, including mail's attachment extraction.
   */
});

describe("provider services: validation", () => {
  test("transcribe rejects empty/absent audio or missing provider", async () => {
    await expect(
      transcription.transcribe({
        audio: Buffer.alloc(0),
        vendor: { api_key: "x", endpoint_url: "http://y" },
      }),
    ).rejects.toThrow(/non-empty audio Buffer/);
    await expect(
      transcription.transcribe({ audio: Buffer.from("hi"), vendor: null }),
    ).rejects.toThrow(/not configured|audio Buffer/);
  });
  test("vision extract rejects empty image or missing provider", async () => {
    await expect(
      vision.extract({ image: Buffer.alloc(0), vendor: { api_key: "x" } }),
    ).rejects.toThrow(/non-empty image Buffer/);
    await expect(
      vision.extract({ image: Buffer.from([1, 2, 3]), vendor: null }),
    ).rejects.toThrow(/not configured|image Buffer/);
  });
});
