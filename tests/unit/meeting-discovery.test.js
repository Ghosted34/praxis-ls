"use strict";
/**
 * F1 — Live Meetings: structured client-discovery capture (MOD-21).
 *
 * The service is unit-tested with the repo, the vault, the event emitter and
 * the job queue mocked, so what is asserted is the ORCHESTRATION — which is
 * where this feature's defects would live:
 *
 *   - the caller cannot write `transcript_vault_id`; only the worker's path can;
 *   - dictation APPENDS rather than replacing what a human already typed;
 *   - a dictation that fails leaves the section saying so, on every failure
 *     route (governance refusal, provider error, empty transcript), rather than
 *     leaving a blank box that reads as "nobody filled this in".
 */
jest.mock("../../src/modules/sales/meeting/meeting.repo");
jest.mock("../../src/modules/vault/document_vault/document_vault.service");
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));
jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn().mockResolvedValue({ id: "job-1" }),
}));

const repo = require("../../src/modules/sales/meeting/meeting.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const { enqueue } = require("../../src/jobs/queue-producer");
const service = require("../../src/modules/sales/meeting/meeting.service");
const rules = require("../../src/modules/sales/meeting/meeting.rules");

const MEETING = "11111111-1111-4111-8111-111111111111";
const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
const audioUrl = (mime = "audio/webm;codecs=opus", bytes = 600) =>
  `data:${mime};base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

beforeEach(() => {
  jest.clearAllMocks();
  client.query.mockResolvedValue({ rows: [] });
  repo.get.mockResolvedValue({ meeting_id: MEETING, subject: "Kickoff", transcript_vault_id: null });
  repo.getSection.mockResolvedValue(null);
  repo.listSections.mockResolvedValue([]);
  repo.listPrompts.mockResolvedValue([]);
  repo.upsertSection.mockImplementation(async (_c, meetingId, sectionKey, fields) => ({
    meeting_id: meetingId, section_key: sectionKey, ...fields,
  }));
  repo.update.mockResolvedValue({ meeting_id: MEETING });
});

describe("the framework itself (pure)", () => {
  test("dictation appends to what a human typed — it never replaces it", () => {
    expect(rules.appendTranscript("Three bullet points.", "And a fourth.")).toBe(
      "Three bullet points. And a fourth.",
    );
    expect(rules.appendTranscript("", "Only this.")).toBe("Only this.");
    expect(rules.appendTranscript("Kept.", "   ")).toBe("Kept.");
  });

  test("emptying a section returns it to EMPTY rather than leaving a stale state", () => {
    expect(rules.stateForBody("something")).toBe("TYPED");
    expect(rules.stateForBody("   ")).toBe("EMPTY");
  });

  test("all three sections always render, in framework order", () => {
    const set = rules.mergeSet([{ section_key: "STRATEGY", body: "x" }], MEETING);
    expect(set.map((s) => s.section_key)).toEqual(["OPERATIONS", "PAIN_POINTS", "STRATEGY"]);
    expect(set[2].body).toBe("x");
    expect(set[0].capture_state).toBe("EMPTY");
  });

  test("a fourth section is not a section", () => {
    expect(() => rules.assertSection("BUDGET")).toThrow(/Unknown discovery section/);
  });
});

describe("saving a section", () => {
  test("upserts the body, marks it TYPED and clears a prior dictation failure", async () => {
    await service.saveSection(client, { meetingId: MEETING, sectionKey: "PAIN_POINTS", body: "Demurrage at Douala.", actor: { user_id: "u1" } });
    const [, , key, fields] = repo.upsertSection.mock.calls[0];
    expect(key).toBe("PAIN_POINTS");
    expect(fields.body).toBe("Demurrage at Douala.");
    expect(fields.capture_state).toBe("TYPED");
    expect(fields.dictation_error).toBeNull();
  });

  test("a caller cannot smuggle a transcript reference through the section save", async () => {
    await service.saveSection(client, { meetingId: MEETING, sectionKey: "OPERATIONS", body: "x", actor: {} });
    const fields = repo.upsertSection.mock.calls[0][3];
    expect(fields).not.toHaveProperty("transcript_vault_id");
  });

  test("an unknown meeting is a 404, not an orphan section", async () => {
    repo.get.mockResolvedValue(null);
    await expect(
      service.saveSection(client, { meetingId: MEETING, sectionKey: "OPERATIONS", body: "x" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(repo.upsertSection).not.toHaveBeenCalled();
  });
});

describe("starting a dictation", () => {
  test("marks the section DICTATING and enqueues ai-transcribe with the section as its target", async () => {
    const res = await service.startDictation(client, {
      meetingId: MEETING, sectionKey: "STRATEGY", audioDataUrl: audioUrl(),
      tenantMeta: { slug: "smartls" }, env: "live", actor: { user_id: "u1" },
    });
    expect(res.job_id).toBe("job-1");
    expect(repo.upsertSection.mock.calls[0][3].capture_state).toBe("DICTATING");
    const [queue, jobName, payload] = enqueue.mock.calls[0];
    expect(queue).toBe("ai-transcribe");
    expect(jobName).toBe("meeting-discovery");
    expect(payload.target).toEqual({
      kind: "meeting_discovery_section", meeting_id: MEETING, section_key: "STRATEGY",
    });
    // The parameterised media type a browser actually produces, normalised.
    expect(payload.mimeType).toBe("audio/webm");
    expect(payload.tenantMeta).toEqual({ slug: "smartls" });
    // The job id is stamped on the section so a stuck dictation is traceable.
    expect(repo.upsertSection.mock.calls[1][3]).toEqual({ dictation_job_id: "job-1" });
  });

  test("refuses a media type we cannot transcribe, before spending a job", async () => {
    await expect(
      service.startDictation(client, { meetingId: MEETING, sectionKey: "STRATEGY", audioDataUrl: audioUrl("video/mp4") }),
    ).rejects.toMatchObject({ status: 422 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("refuses audio the API's own body limit could never have delivered", async () => {
    await expect(
      service.startDictation(client, {
        meetingId: MEETING, sectionKey: "STRATEGY",
        audioDataUrl: audioUrl("audio/webm", rules.MAX_AUDIO_BYTES + 1024),
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a queue that will not take the job rolls the DICTATING mark back", async () => {
    enqueue.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      service.startDictation(client, { meetingId: MEETING, sectionKey: "OPERATIONS", audioDataUrl: audioUrl() }),
    ).rejects.toThrow(/redis down/);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});

describe("landing a transcript (the worker's path)", () => {
  test("vaults the text, appends it to the section and stamps both references", async () => {
    repo.getSection.mockResolvedValue({ body: "Typed already.", section_key: "OPERATIONS" });
    vault.createDocument.mockResolvedValue({ doc_id: "doc-9" });

    await service.applyTranscript(client, {
      meetingId: MEETING, sectionKey: "OPERATIONS", text: "  Dictated too.  ",
      audioSeconds: 42, slug: "smartls", actor: { user_id: "u1" },
    });

    const doc = vault.createDocument.mock.calls[0][1];
    expect(doc.docType).toBe("MEETING_TRANSCRIPT");
    expect(doc.dataUrl.startsWith("data:text/plain;base64,")).toBe(true);
    expect(Buffer.from(doc.dataUrl.split(",")[1], "base64").toString("utf8")).toBe("Dictated too.");

    const fields = repo.upsertSection.mock.calls[0][3];
    expect(fields.body).toBe("Typed already. Dictated too.");
    expect(fields.capture_state).toBe("TRANSCRIBED");
    expect(fields.transcript_vault_id).toBe("doc-9");
    expect(fields.audio_seconds).toBe(42);
    // The meeting-level column from 0350 now means "the latest transcript on
    // this meeting", and is written HERE rather than read off a request body.
    expect(repo.update).toHaveBeenCalledWith(client, MEETING, { transcript_vault_id: "doc-9" });
  });

  test("a transcript with no speech in it is a FAILURE, not a successful blank", async () => {
    await service.applyTranscript(client, {
      meetingId: MEETING, sectionKey: "PAIN_POINTS", text: "   ", slug: "smartls",
    });
    const fields = repo.upsertSection.mock.calls[0][3];
    expect(fields.capture_state).toBe("TRANSCRIPTION_FAILED");
    expect(fields.dictation_error).toMatch(/no speech/i);
    expect(vault.createDocument).not.toHaveBeenCalled();
  });

  test("a failed dictation does not wipe what was already typed", async () => {
    await service.failDictation(client, { meetingId: MEETING, sectionKey: "STRATEGY", reason: "provider timeout" });
    const fields = repo.upsertSection.mock.calls[0][3];
    expect(fields).not.toHaveProperty("body");
    expect(fields.capture_state).toBe("TRANSCRIPTION_FAILED");
  });
});

describe("the discovery set a proposal is drafted from", () => {
  test("asking for it without naming a lead or a client is a validation error", async () => {
    await expect(service.latestDiscoveryFor(client, {})).rejects.toMatchObject({ status: 422 });
  });

  test("a lead that has been met but never written up returns null, not an error", async () => {
    repo.latestDiscovery.mockResolvedValue(null);
    await expect(service.latestDiscoveryFor(client, { leadId: "l1" })).resolves.toBeNull();
  });

  test("returns all three sections with their labels, and says whether anything was captured", async () => {
    repo.latestDiscovery.mockResolvedValue({
      meeting_id: MEETING,
      sections: [{ section_key: "PAIN_POINTS", body: "Customs delays.", capture_state: "TYPED" }],
    });
    const set = await service.latestDiscoveryFor(client, { leadId: "l1" });
    expect(set.sections).toHaveLength(3);
    expect(set.sections[1].label_en).toBe("Operational Bottlenecks");
    expect(set.has_content).toBe(true);
  });
});
