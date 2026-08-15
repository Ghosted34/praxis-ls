"use strict";
/**
 * F1 — the ai-transcribe worker's TARGETED path.
 *
 * The handler previously had one destination: every transcript became a message
 * to the copilot. A dictation on a record needs the opposite — no conversation
 * turn at all, and the text written onto the section by the owning module.
 *
 * What is asserted here is the branch and, more importantly, the three ways a
 * dictation can end badly. Each of them must reach the record, because the
 * person who spoke into the microphone believes their words were captured.
 */
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: (_meta, _env, fn) => fn({ query: jest.fn() }),
  tenantIdOf: () => "t1",
}));
jest.mock("../../src/services/ai/transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../src/services/ai/orchestrator.service", () => ({ ask: jest.fn().mockResolvedValue({ reply: "hi" }) }));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn().mockResolvedValue({ allowed: true }),
  recordUsage: jest.fn(),
}));
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn().mockResolvedValue(null) }));
jest.mock("../../src/services/ai/action-registrar", () => ({ buildExecutorMap: () => ({}) }));
jest.mock("../../src/modules/sales/meeting/meeting.service", () => ({
  applyTranscript: jest.fn().mockResolvedValue({ capture_state: "TRANSCRIBED" }),
  failDictation: jest.fn().mockResolvedValue({ capture_state: "TRANSCRIPTION_FAILED" }),
}));

const handler = require("../../src/jobs/handlers/ai-transcribe");
const transcription = require("../../src/services/ai/transcription.service");
const orchestrator = require("../../src/services/ai/orchestrator.service");
const governance = require("../../src/modules/ai/governance/governance.service");
const meetings = require("../../src/modules/sales/meeting/meeting.service");

const target = { kind: "meeting_discovery_section", meeting_id: "m1", section_key: "OPERATIONS" };
const job = (over = {}) => ({
  data: {
    tenantMeta: { slug: "smartls" }, env: "live", user: { user_id: "u1" },
    audioBase64: Buffer.from("audio").toString("base64"), mimeType: "audio/webm",
    ...over,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  governance.canUseFeature.mockResolvedValue({ allowed: true });
  transcription.transcribe.mockResolvedValue({ text: "They ship perishables.", audio_seconds: 12, provider: "groq" });
});

test("a targeted transcript goes to the record and starts NO copilot turn", async () => {
  const res = await handler(job({ target }));
  expect(meetings.applyTranscript).toHaveBeenCalledTimes(1);
  const args = meetings.applyTranscript.mock.calls[0][1];
  expect(args).toMatchObject({ meetingId: "m1", sectionKey: "OPERATIONS", text: "They ship perishables.", audioSeconds: 12, slug: "smartls" });
  expect(orchestrator.ask).not.toHaveBeenCalled();
  expect(res.target).toBe("meeting_discovery_section");
});

test("an untargeted transcript still becomes a copilot turn — the original behaviour is intact", async () => {
  await handler(job());
  expect(orchestrator.ask).toHaveBeenCalledTimes(1);
  expect(meetings.applyTranscript).not.toHaveBeenCalled();
});

test("a governance refusal is written onto the section, not just returned", async () => {
  governance.canUseFeature.mockResolvedValue({ allowed: false, reason: "the plan's AI spend limit for this month has been reached" });
  const res = await handler(job({ target }));
  expect(res.blocked).toBe(true);
  expect(meetings.failDictation).toHaveBeenCalledTimes(1);
  expect(meetings.failDictation.mock.calls[0][1].reason).toMatch(/spend limit/);
  expect(transcription.transcribe).not.toHaveBeenCalled();
  expect(meetings.applyTranscript).not.toHaveBeenCalled();
});

test("a provider error marks the section BEFORE the throw, so the retry window is honest", async () => {
  transcription.transcribe.mockRejectedValue(new Error("groq 503"));
  await expect(handler(job({ target }))).rejects.toThrow(/groq 503/);
  expect(meetings.failDictation).toHaveBeenCalledTimes(1);
  expect(meetings.failDictation.mock.calls[0][1].reason).toMatch(/groq 503/);
});

test("a failure to record the failure never replaces the original error", async () => {
  transcription.transcribe.mockRejectedValue(new Error("groq 503"));
  meetings.failDictation.mockRejectedValue(new Error("db gone"));
  await expect(handler(job({ target }))).rejects.toThrow(/groq 503/);
});

test("an unknown target kind is a programming error and says so", async () => {
  await expect(handler(job({ target: { kind: "nope" } }))).rejects.toThrow(/unknown target kind/i);
});

test("usage is metered on the targeted path too — a dictation is spend", async () => {
  await handler(job({ target }));
  expect(governance.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ featureKey: "voice", callType: "transcribe", audioSeconds: 12 }));
});
