"use strict";
/**
 * Smart Comms calls — the RECORD half (PR-2, guide §4.5 / §4.9 / §4.10).
 *
 * The pipeline is tested against a fake repo that owns the same invariants the
 * SQL does (one current transcript row per Side × part, retired-not-deleted
 * upgrades, guarded draft transitions) plus jest mocks for the three outside
 * worlds it touches: object storage, the transcription vendor and the LLM.
 *
 * The point of the suite is the CONTRACT, not the plumbing: part assembly, the
 * whole-side fallback, the summary's language rules, and the caller's guards.
 */
const mockStore = { current: null };

jest.mock("../../src/modules/smartcomm/smartcomm.call.repo", () => {
  const on = () => mockStore.current;
  const partsOf = (callId) => on().parts.filter((p) => p.call_id === callId);
  const currentRows = (callId, side = null) =>
    on().transcripts.filter((t) => t.call_id === callId && t.is_current && (!side || t.side === side));
  return {
    findCall: async (c, callId) => on().calls.get(callId) || null,
    listRecordingParts: async (c, callId) =>
      partsOf(callId).slice().sort((a, b) => (a.side < b.side ? -1 : 1) || a.part_index - b.part_index),
    setPartResult: async (c, { recordingId, status, language = null, error = null, attempts }) => {
      const p = on().parts.find((x) => x.recording_id === recordingId);
      Object.assign(p, { transcript_status: status, detected_language: language, error, attempts });
      return p;
    },
    listLiveLog: async (c, { callId, side = null }) =>
      on().live.filter((r) => r.call_id === callId && (!side || r.side === side)),
    upsertLiveLog: async (c, { callId, side, segments }) => {
      for (const s of segments) {
        const existing = on().live.find((r) => r.call_id === callId && r.side === side && r.seq === s.seq);
        const row = { call_id: callId, side, ...s };
        if (existing) Object.assign(existing, row);
        else on().live.push(row);
      }
      return segments.length;
    },
    insertTranscriptRows: async (c, { callId, side, rows }) => {
      // The real repo does the retire of the same keys and the insert in ONE
      // transaction (unique index on the current row). Same effect here.
      for (const r of rows) {
        for (const t of currentRows(callId, side)) {
          if (t.part_index === r.partIndex) {
            t.is_current = false;
            t.superseded_at = new Date().toISOString();
          }
        }
      }
      const inserted = rows.map((r) => {
        const row = {
          transcript_id: `tr-${on().transcripts.length + 1}`,
          call_id: callId,
          side,
          part_index: r.partIndex,
          text: r.text,
          language: r.language,
          provider: r.provider,
          certified: r.certified,
          is_current: true,
          superseded_at: null,
        };
        on().transcripts.push(row);
        return row;
      });
      return inserted;
    },
    retireFlaggedRows: async (c, { callId, side }) => {
      let n = 0;
      for (const t of currentRows(callId, side)) {
        if (t.provider === "browser-live") {
          t.is_current = false;
          t.superseded_at = new Date().toISOString();
          n += 1;
        }
      }
      return n;
    },
    listCurrentTranscripts: async (c, callId, side = null) => currentRows(callId, side),
    hasFlaggedRows: async (c, callId) => currentRows(callId).some((t) => t.provider === "browser-live"),
    setTranscriptionState: async (c, { callId, state, error = null }) => {
      const call = on().calls.get(callId);
      Object.assign(call, {
        transcription_state: state,
        transcription_error: error,
        transcription_updated_at: new Date().toISOString(),
      });
      return call;
    },
    bumpTranscriptionAttempts: async (c, callId) => {
      const call = on().calls.get(callId);
      call.transcription_attempts = (call.transcription_attempts || 0) + 1;
      return call;
    },
    listFailedTranscriptions: async (c, { maxAttempts = 20 } = {}) =>
      [...on().calls.values()].filter(
        (x) => x.transcription_state === "TRANSCRIPTION_FAILED" && (x.transcription_attempts || 0) < maxAttempts,
      ),
    listUntranscribedEndedCalls: async () =>
      [...on().calls.values()].filter(
        (x) => ["ENDED", "FAILED"].includes(x.status) &&
          (!x.transcription_state || x.transcription_state === "PENDING"),
      ),
    upsertRecordingPart: async (c, { callId, side, partIndex, partCount, vaultRef, mediaType, sizeBytes, durationSeconds }) => {
      const existing = on().parts.find(
        (p) => p.call_id === callId && p.side === side && p.part_index === partIndex,
      );
      const row = {
        recording_id: existing ? existing.recording_id : `rec-${on().parts.length + 1}`,
        call_id: callId,
        side,
        part_index: partIndex,
        part_count: partCount,
        vault_ref: vaultRef,
        media_type: mediaType,
        size_bytes: sizeBytes,
        duration_seconds: durationSeconds,
        detected_language: null,
        transcript_status: "PENDING",
        attempts: 0,
        error: null,
        purged_at: null,
        created_at: (existing && existing.created_at) || new Date().toISOString(),
      };
      if (existing) Object.assign(existing, row);
      else on().parts.push(row);
      return row;
    },
    partsAwaitingPurge: async (c, { olderThanDays }) =>
      on().parts.filter((p) => !p.purged_at && Number(p.age_days || 0) >= olderThanDays),
    markPartsPurged: async (c, ids) => {
      let n = 0;
      for (const p of on().parts) {
        if (ids.includes(p.recording_id) && !p.purged_at) {
          p.purged_at = new Date().toISOString();
          n += 1;
        }
      }
      return n;
    },
    setSummaryLanguage: async (c, { callId, language }) => {
      const call = on().calls.get(callId);
      if (!call || call.summary_language === language) return null;
      call.summary_language = language;
      return call;
    },
    upsertSummaryDraft: async (c, { callId, summaryText, keyPoints, followUps, language, provenance }) => {
      const existing = on().summaries.get(callId);
      const row = {
        summary_id: (existing && existing.summary_id) || `sum-${on().summaries.size + 1}`,
        call_id: callId,
        summary_text: summaryText,
        key_points: keyPoints || [],
        follow_ups: followUps || [],
        language,
        provenance,
        draft_status: "PENDING_REVIEW",
        sent_message_id: (existing && existing.sent_message_id) || null,
        update_available: false,
        update_message_id: (existing && existing.update_message_id) || null,
        regenerate_count: (existing && existing.regenerate_count) || 0,
      };
      on().summaries.set(callId, row);
      return row;
    },
    applySummaryEdit: async (c, { callId, summaryText, keyPoints, followUps }) => {
      const row = on().summaries.get(callId);
      if (!row) return null;
      Object.assign(row, { summary_text: summaryText, key_points: keyPoints, follow_ups: followUps });
      return row;
    },
    getSummary: async (c, callId) => on().summaries.get(callId) || null,
    markSummarySent: async (c, { callId, messageId }) => {
      const row = on().summaries.get(callId);
      Object.assign(row, { draft_status: "SENT", sent_message_id: messageId, update_available: false });
      return row;
    },
    markSummaryUpdateSent: async (c, { callId, messageId }) => {
      const row = on().summaries.get(callId);
      Object.assign(row, { update_message_id: messageId, update_available: false });
      return row;
    },
    markUpdateAvailable: async (c, callId) => {
      const row = on().summaries.get(callId);
      if (!row || row.draft_status !== "SENT") return null;
      row.update_available = true;
      return row;
    },
    markSummaryDiscarded: async (c, callId) => {
      const row = on().summaries.get(callId);
      if (!row || row.draft_status !== "PENDING_REVIEW") return null;
      row.draft_status = "DISCARDED";
      return row;
    },
    bumpRegenerateCount: async (c, { callId, language }) => {
      const row = on().summaries.get(callId);
      row.regenerate_count += 1;
      row.language = language;
      return row;
    },
  };
});

jest.mock("../../src/services/storage.service", () => ({
  put: jest.fn(async () => {}),
  get: jest.fn(async () => Buffer.from("audio-bytes")),
  delete: jest.fn(async () => {}),
}));
jest.mock("../../src/services/ai/transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../src/services/ai/llm.service", () => ({ chat: jest.fn() }));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ allowed: true })),
  recordUsage: jest.fn(async () => {}),
}));
jest.mock("../../src/services/platform/alert-routing.service", () => ({ raise: jest.fn(async () => {}) }));
jest.mock("../../src/realtime", () => ({ publishToUser: jest.fn(() => {}) }));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({ id: "job-1" })) }));
jest.mock("../../src/modules/smartcomm/smartcomm.service", () => ({
  postMessage: jest.fn(async () => ({ message_id: "msg-1" })),
}));

const storage = require("../../src/services/storage.service");
const transcription = require("../../src/services/ai/transcription.service");
const llm = require("../../src/services/ai/llm.service");
const governance = require("../../src/modules/ai/governance/governance.service");
const alerts = require("../../src/services/platform/alert-routing.service");
const realtime = require("../../src/realtime");
const { enqueue } = require("../../src/jobs/queue-producer");
const smartcomm = require("../../src/modules/smartcomm/smartcomm.service");
const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const CALL = "call-1";
const GROUP = "33333333-3333-3333-3333-333333333333";

function blankState(over = {}) {
  return { calls: new Map(), parts: [], live: [], transcripts: [], summaries: new Map(), ...over };
}

function endedCall(over = {}) {
  return {
    call_id: CALL,
    group_id: GROUP,
    caller_id: U1,
    callee_id: U2,
    status: "ENDED",
    connected_at: new Date(Date.now() - 600_000).toISOString(),
    ended_at: new Date(Date.now() - 120_000).toISOString(),
    duration_seconds: 300,
    transcription_state: null,
    transcription_error: null,
    transcription_attempts: 0,
    transcription_updated_at: null,
    summary_language: "en",
    ...over,
  };
}

function part(side, partIndex, { duration = 60, parts: total = 2, age = 0 } = {}) {
  return {
    recording_id: `rec-${side}-${partIndex}`,
    call_id: CALL,
    side,
    part_index: partIndex,
    part_count: total,
    vault_ref: `tenant_acme/comms/calls/${CALL}/${side}_00${partIndex}_ab.webm`,
    media_type: "audio/webm",
    size_bytes: 400_000,
    duration_seconds: duration,
    detected_language: null,
    transcript_status: "PENDING",
    attempts: 0,
    error: null,
    purged_at: null,
    created_at: new Date(Date.now() - age * 86_400_000).toISOString(),
    age_days: age,
  };
}

function client({ featureState = "on", names = [], cards = [] } = {}) {
  return {
    query: async (sql) => {
      if (/FROM feature_state WHERE feature_key/.test(sql)) {
        return { rows: featureState === "on" ? [{ state: "on" }] : [] };
      }
      if (/FROM app_user WHERE user_id = ANY/.test(sql)) return { rows: names };
      if (/FROM comms_call_summary s/.test(sql)) return { rows: cards };
      return { rows: [] };
    },
  };
}

const caller = { user_id: U1 };
const callee = { user_id: U2 };
const NAMES = [
  { user_id: U1, full_name: "Awa Diallo" },
  { user_id: U2, full_name: "Bruno Kamga" },
];

beforeEach(() => {
  mockStore.current = blankState();
  transcription.transcribe.mockReset();
  llm.chat.mockReset();
  governance.canUseFeature.mockResolvedValue({ allowed: true });
  storage.get.mockResolvedValue(Buffer.from("audio-bytes"));
  storage.delete.mockResolvedValue(undefined);
  smartcomm.postMessage.mockResolvedValue({ message_id: "msg-1" });
});

const rtTo = (userId, event) =>
  realtime.publishToUser.mock.calls.filter((c) => c[1] === userId && c[2] === event);

/* ── The pure helpers: the contract, tested directly ─────────────────────── */

describe("language + side helpers", () => {
  test("the vendor's language answer is narrowed to EN/FR, and unknown answers fall back", () => {
    expect(pipeline.toEnFr("English")).toBe("en");
    expect(pipeline.toEnFr("french")).toBe("fr");
    expect(pipeline.toEnFr("FR")).toBe("fr");
    // A third language in a French call is a mis-detection, not a new language:
    // the product speaks two, and inventing one would break the language chips.
    expect(pipeline.toEnFr("es", "fr")).toBe("fr");
    expect(pipeline.toEnFr(null, "fr")).toBe("fr");
  });

  test("only an ENDED call, or one that connected and then died, has a record", () => {
    expect(pipeline.isPipelineEligible(endedCall())).toBe(true);
    // ICE blow-up after media started: there IS audio on both phones.
    expect(pipeline.isPipelineEligible(endedCall({ status: "FAILED", end_reason: "ice_failed" }))).toBe(true);
    // Never connected — nothing was recorded, and nothing should be pretended.
    expect(pipeline.isPipelineEligible(endedCall({ status: "FAILED", connected_at: null }))).toBe(false);
    expect(pipeline.isPipelineEligible(endedCall({ status: "CANCELLED" }))).toBe(false);
  });

  test("a part's span is derived from the parts' own durations", () => {
    const spans = pipeline.partSpans([part("caller", 1, { duration: 60 }), part("caller", 2, { duration: 90 })]);
    expect(spans).toEqual([
      { partIndex: 1, startMs: 0, endMs: 60_000 },
      { partIndex: 2, startMs: 60_000, endMs: 150_000 },
    ]);
  });
});

describe("the live capture is cut along the part spans", () => {
  const spans = [
    { partIndex: 1, startMs: 0, endMs: 60_000 },
    { partIndex: 2, startMs: 60_000, endMs: 120_000 },
  ];

  test("a segment goes to the span containing its MIDPOINT, so a sentence is never cut in half", () => {
    const buckets = pipeline.groupSegmentsByPart(
      [
        { seq: 0, text: "bonjour", started_ms: 0, ended_ms: 2_000 },
        // Straddles the 60 s boundary; midpoint 60.5 s belongs to part 2.
        { seq: 1, text: "on continue", started_ms: 59_000, ended_ms: 62_000 },
        { seq: 2, text: "au revoir", started_ms: 119_000, ended_ms: 120_000 },
      ],
      spans,
    );
    expect(buckets.get(1).map((s) => s.text)).toEqual(["bonjour"]);
    expect(buckets.get(2).map((s) => s.text)).toEqual(["on continue", "au revoir"]);
  });

  test("a segment with no timestamps is kept in the LAST span rather than dropped", () => {
    const buckets = pipeline.groupSegmentsByPart([{ seq: 0, text: "sans horodatage" }], spans);
    expect(buckets.get(2).map((s) => s.text)).toEqual(["sans horodatage"]);
  });

  test("the fallback rows cover the same spans, one row each, always flagged", () => {
    const rows = pipeline.fallbackRowsForSide({
      side: "caller",
      parts: [part("caller", 1, { duration: 60 }), part("caller", 2, { duration: 60 })],
      segments: [
        { seq: 0, text: "bonjour", language: "fr", started_ms: 0, ended_ms: 2_000 },
        { seq: 1, text: "au revoir", language: "fr", started_ms: 61_000, ended_ms: 62_000 },
      ],
      language: "fr",
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.provider === "browser-live" && r.certified === false)).toBe(true);
    expect(rows.map((r) => r.text)).toEqual(["bonjour", "au revoir"]);
    expect(rows.map((r) => r.language)).toEqual(["fr", "fr"]);
  });

  test("a span the recogniser heard nothing in still becomes a row: the hole is visible, not silent", () => {
    const rows = pipeline.fallbackRowsForSide({
      side: "callee",
      parts: [part("callee", 1, { duration: 60 }), part("callee", 2, { duration: 60 })],
      segments: [{ seq: 0, text: "", language: "en", started_ms: 61_000, ended_ms: 62_000 }],
      language: "en",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe("");
  });
});

describe("the attributed transcript", () => {
  test("Caller then Callee, part order preserved, each part labelled with its own language", () => {
    const built = pipeline.buildAttributedTranscript({
      rows: [
        { side: "callee", part_index: 1, text: "hello", language: "en", provider: "groq", certified: true },
        { side: "caller", part_index: 2, text: "oui, tout de suite", language: "fr", provider: "groq", certified: true },
        { side: "caller", part_index: 1, text: "bonjour", language: "fr", provider: "groq", certified: true },
      ],
      names: { caller: "Awa Diallo", callee: "Bruno Kamga" },
    });
    expect(built.text).toContain("Caller (Awa Diallo):");
    expect(built.text).toContain("[fr] bonjour");
    expect(built.text).toContain("[en] hello");
    // Part order inside a side, never the order the rows came back in.
    expect(built.text.indexOf("bonjour")).toBeLessThan(built.text.indexOf("tout de suite"));
    expect(built.sides.find((s) => s.side === "caller").certified).toBe(true);
  });

  test("a side with any flagged row is not certified as a whole", () => {
    const built = pipeline.buildAttributedTranscript({
      rows: [
        { side: "caller", part_index: 1, text: "a", language: "en", provider: "groq", certified: true },
        { side: "caller", part_index: 2, text: "b", language: "en", provider: "browser-live", certified: false },
      ],
    });
    expect(built.sides.find((s) => s.side === "caller").certified).toBe(false);
  });

  test("provenance: the LLM being down outranks the transcript's own provenance", () => {
    expect(pipeline.provenanceOf({ llmOk: false, certified: true })).toBe("transcript-only");
    expect(pipeline.provenanceOf({ llmOk: true, certified: true })).toBe("groq");
    expect(pipeline.provenanceOf({ llmOk: true, certified: false })).toBe("browser-live");
  });
});

describe("live-log normalisation", () => {
  test("malformed segments are dropped, seq is de-duplicated, and the fallback language is used", () => {
    const out = pipeline.normaliseSegments(
      [
        { text: "un" },
        { text: "deux", seq: 0 },
        { text: "  " },
        { text: "trois", language: "es" },
        "nope",
      ],
      "fr",
    );
    expect(out.map((s) => s.text)).toEqual(["un", "trois"]);
    expect(out.every((s) => s.language === "fr")).toBe(true);
    expect(new Set(out.map((s) => s.seq)).size).toBe(out.length);
  });

  test("a live log that is not JSON is an empty log, never a thrown error", () => {
    expect(pipeline.normaliseSegments("{not json", "en")).toEqual([]);
  });
});

/* ── Ingest ─────────────────────────────────────────────────────────────── */

describe("ingest", () => {
  test("a side can only upload its own audio", async () => {
    mockStore.current.calls.set(CALL, endedCall());
    await expect(
      pipeline.registerPart(client(), {
        callId: CALL,
        actor: caller,
        side: "callee",
        partIndex: 1,
        partCount: 1,
        file: { buffer: Buffer.from("x"), mimetype: "audio/webm" },
      }),
    ).rejects.toMatchObject({ code: "NOT_YOUR_SIDE", status: 403 });
  });

  test("a part lands in storage under the call's own prefix and is recorded PENDING", async () => {
    mockStore.current.calls.set(CALL, endedCall());
    const out = await pipeline.registerPart(client(), {
      callId: CALL,
      actor: caller,
      side: "caller",
      partIndex: 1,
      partCount: 2,
      durationMs: 61_000,
      language: "fr",
      file: { buffer: Buffer.from("x"), mimetype: "audio/webm" },
      slug: "acme",
    });
    expect(out.transcript_status).toBe("PENDING");
    const [, { key }] = storage.put.mock.calls[0];
    expect(key).toMatch(/^tenant_acme\/comms\/calls\/call-1\/caller_001_[0-9a-f]{12}\.webm$/);
    // The CALLER's app language is what the draft will be written in.
    expect(mockStore.current.calls.get(CALL).summary_language).toBe("fr");
    expect(mockStore.current.calls.get(CALL).transcription_state).toBe("PENDING");
  });

  test("the CALLEE's app language never becomes the call's draft language", async () => {
    mockStore.current.calls.set(CALL, endedCall({ summary_language: "en" }));
    await pipeline.registerPart(client(), {
      callId: CALL,
      actor: callee,
      side: "callee",
      partIndex: 1,
      partCount: 1,
      durationMs: 30_000,
      language: "fr",
      file: { buffer: Buffer.from("x"), mimetype: "audio/webm" },
    });
    expect(mockStore.current.calls.get(CALL).summary_language).toBe("en");
  });

  test("a part larger than the ceiling is refused with a sentence the caller can read", async () => {
    mockStore.current.calls.set(CALL, endedCall());
    await expect(
      pipeline.registerPart(client(), {
        callId: CALL,
        actor: caller,
        side: "caller",
        partIndex: 1,
        partCount: 1,
        file: { buffer: Buffer.alloc(13 * 1024 * 1024), mimetype: "audio/webm" },
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", status: 413 });
  });

  test("the live log uploads without any audio (the one upload that must survive a dead recorder)", async () => {
    mockStore.current.calls.set(CALL, endedCall());
    const out = await pipeline.registerLiveLog(client(), {
      callId: CALL,
      actor: callee,
      side: "callee",
      segments: [{ seq: 0, text: "hello", language: "en", started_ms: 1_000, ended_ms: 2_000 }],
    });
    expect(out.written).toBe(1);
    expect(mockStore.current.live).toHaveLength(1);
  });
});

/* ── The pipeline ───────────────────────────────────────────────────────── */

describe("processCall — the certified path", () => {
  beforeEach(() => {
    mockStore.current.calls.set(CALL, endedCall());
    mockStore.current.parts.push(part("caller", 1), part("caller", 2), part("callee", 1), part("callee", 2));
    transcription.transcribe.mockResolvedValue({
      text: "bonjour",
      audio_seconds: 60,
      provider: "groq",
      detected_language: "French",
    });
    llm.chat.mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-chat",
      usage: { prompt_tokens: 100, completion_tokens: 40 },
      text: JSON.stringify({
        summary: "Vous avez confirmé la livraison.",
        key_points: [{ text: "Livraison confirmée", raised_by: "caller" }],
        follow_ups: [{ text: "Envoyer le bon de livraison", owner: "caller", due: "2026-09-30" }],
      }),
    });
  });

  test("every part certified → CERTIFIED rows, a groq draft, and the caller is told", async () => {
    const out = await pipeline.processCall(client({ names: NAMES }), { callId: CALL, slug: "acme" });

    expect(out.state).toBe("CERTIFIED");
    expect(transcription.transcribe).toHaveBeenCalledTimes(4);
    // NO language hint is ever sent for a call (guide row 7).
    expect(transcription.transcribe.mock.calls.every((c) => c[0].language === null)).toBe(true);
    expect(transcription.transcribe.mock.calls.every((c) => c[0].detectLanguage === true)).toBe(true);

    const rows = mockStore.current.transcripts.filter((t) => t.is_current);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.certified === true && r.provider === "groq")).toBe(true);
    // The vendor said "French"; the row says fr.
    expect(rows.find((r) => r.side === "caller" && r.part_index === 1).language).toBe("fr");

    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.draft_status).toBe("PENDING_REVIEW");
    expect(summary.provenance).toBe("groq");
    expect(summary.summary_text).toBe("Vous avez confirmé la livraison.");
    // VERBATIM: the key point and the follow-up come through unaltered.
    expect(summary.key_points).toEqual([{ text: "Livraison confirmée", raised_by: "caller" }]);
    expect(summary.follow_ups).toEqual([{ text: "Envoyer le bon de livraison", owner: "caller", due: "2026-09-30" }]);

    expect(rtTo(U1, "call:summary_ready")).toHaveLength(1);
    expect(governance.recordUsage).toHaveBeenCalled();
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  test("the draft is written in the CALLER's app language, whatever language was spoken", async () => {
    mockStore.current.calls.get(CALL).summary_language = "fr";
    llm.chat.mockResolvedValue({
      provider: "deepseek",
      text: JSON.stringify({ summary: "Résumé en français.", key_points: [], follow_ups: [] }),
    });
    await pipeline.processCall(client({ names: NAMES }), { callId: CALL });
    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.language).toBe("fr");
    // The prompt says the prose is in fr and the quotations are NOT translated.
    const [prompt] = llm.chat.mock.calls[0];
    expect(prompt.messages[0].content).toMatch(/fr/i);
    expect(prompt.messages[0].content).toMatch(/verbatim/i);
  });

  test("the LLM being down degrades the draft to the transcript, and never blocks the send", async () => {
    // llm.chat's documented degradation: a stub with provider null.
    llm.chat.mockResolvedValue({ provider: null, text: "The AI assistant has no chat provider configured yet." });
    await pipeline.processCall(client({ names: NAMES }), { callId: CALL, tenantMeta: { slug: "acme" } });
    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.provenance).toBe("transcript-only");
    expect(summary.summary_text).toContain("[fr] bonjour");
    expect(summary.draft_status).toBe("PENDING_REVIEW");
    expect(rtTo(U1, "call:summary_ready")).toHaveLength(1);
  });
});

describe("processCall — the whole-side fallback (§4.5)", () => {
  beforeEach(() => {
    mockStore.current.calls.set(CALL, endedCall());
    // Part 1 of each side is fine; part 2 of the CALLER fails all three tries.
    mockStore.current.parts.push(part("caller", 1), part("caller", 2), part("callee", 1));
    mockStore.current.live.push(
      { call_id: CALL, side: "caller", seq: 0, text: "bonjour", language: "fr", started_ms: 1_000, ended_ms: 2_000 },
      { call_id: CALL, side: "caller", seq: 1, text: "à bientôt", language: "fr", started_ms: 61_000, ended_ms: 62_000 },
    );
    transcription.transcribe.mockImplementation(async ({ audio, vendor } = {}) => {
      void audio;
      void vendor;
      const failed = transcription.transcribe.mock.calls.length;
      // Calls 1 (caller part 1), 4 (callee part 1) succeed; the three attempts
      // against caller part 2 (calls 2–4 shifted by the first success) fail.
      if (failed === 2 || failed === 3 || failed === 4) throw new Error("upstream 502");
      return { text: "bonjour", audio_seconds: 60, provider: "groq", detected_language: "fr" };
    });
    llm.chat.mockResolvedValue({
      provider: "deepseek",
      text: JSON.stringify({ summary: "Fallback draft.", key_points: [], follow_ups: [] }),
    });
  });

  test("one bad part fails its WHOLE side: flagged rows covering every span, part marked FAILED", async () => {
    const out = await pipeline.processCall(client({ names: NAMES }), {
      callId: CALL, tenantMeta: { slug: "acme" },
    });

    expect(out.state).toBe("TRANSCRIPTION_FAILED");
    expect(out.sides.caller).toBe("flagged");
    expect(out.sides.callee).toBe("certified");

    const callerRows = mockStore.current.transcripts.filter((t) => t.side === "caller" && t.is_current);
    // Two parts → two rows, both from the browser capture: never a mixture.
    expect(callerRows).toHaveLength(2);
    expect(callerRows.every((r) => r.provider === "browser-live" && r.certified === false)).toBe(true);
    expect(callerRows.map((r) => r.text)).toEqual(["bonjour", "à bientôt"]);

    // The callee's certified words are unaffected.
    const calleeRows = mockStore.current.transcripts.filter((t) => t.side === "callee" && t.is_current);
    expect(calleeRows.every((r) => r.certified === true)).toBe(true);

    const failedPart = mockStore.current.parts.find((p) => p.side === "caller" && p.part_index === 2);
    expect(failedPart.transcript_status).toBe("FAILED");
    expect(failedPart.attempts).toBe(3);

    // Visible on both ends, alerted to ops, retried by the sweep.
    expect(mockStore.current.calls.get(CALL).transcription_state).toBe("TRANSCRIPTION_FAILED");
    expect(rtTo(U1, "call:transcription_failed")).toHaveLength(1);
    expect(rtTo(U2, "call:transcription_failed")).toHaveLength(1);
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({
      event: "comms.transcription_failed",
      tenant: "acme",
    }));

    // The draft exists anyway, visibly labelled with what it is worth.
    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.provenance).toBe("browser-live");
    expect(summary.draft_status).toBe("PENDING_REVIEW");
  });

  test("the reprocess REPLACES the flagged rows: certified lands, flagged is retired, not deleted", async () => {
    // First run: fallback.
    await pipeline.processCall(client({ names: NAMES }), { callId: CALL });
    const flaggedBefore = mockStore.current.transcripts.filter((t) => t.provider === "browser-live");
    expect(flaggedBefore).toHaveLength(2);

    // The vendor recovers.
    transcription.transcribe.mockResolvedValue({
      text: "bonjour", audio_seconds: 60, provider: "groq", detected_language: "fr",
    });
    await pipeline.processCall(client({ names: NAMES }), { callId: CALL });

    const current = mockStore.current.transcripts.filter((t) => t.is_current);
    expect(current.every((r) => r.certified === true)).toBe(true);
    // The flagged rows are still in the table — what the caller was told at the
    // time is part of the record — but they are no longer current.
    const retired = mockStore.current.transcripts.filter((t) => t.provider === "browser-live" && !t.is_current);
    expect(retired).toHaveLength(2);
    expect(mockStore.current.calls.get(CALL).transcription_state).toBe("CERTIFIED");
  });
});

describe("processCall — guards", () => {
  test("a SENT summary is never rewritten; the caller is OFFERED an update instead", async () => {
    mockStore.current.calls.set(CALL, endedCall({ transcription_state: "TRANSCRIPTION_FAILED" }));
    mockStore.current.parts.push(part("caller", 1), part("callee", 1));
    mockStore.current.transcripts.push(
      { transcript_id: "t1", call_id: CALL, side: "caller", part_index: 1, text: "flagged words", language: "en", provider: "browser-live", certified: false, is_current: true },
      { transcript_id: "t2", call_id: CALL, side: "callee", part_index: 1, text: "flagged words", language: "en", provider: "browser-live", certified: false, is_current: true },
    );
    mockStore.current.summaries.set(CALL, {
      summary_id: "s1", call_id: CALL, summary_text: "The sent summary.", key_points: [], follow_ups: [],
      language: "en", provenance: "browser-live", draft_status: "SENT", sent_message_id: "msg-9",
      update_available: false, update_message_id: null, regenerate_count: 0,
    });
    transcription.transcribe.mockResolvedValue({
      text: "certified words", audio_seconds: 60, provider: "groq", detected_language: "en",
    });
    llm.chat.mockResolvedValue({ provider: "deepseek", text: JSON.stringify({ summary: "A better draft.", key_points: [], follow_ups: [] }) });

    const out = await pipeline.processCall(client({ names: NAMES }), {
      callId: CALL, tenantMeta: { slug: "acme" },
    });

    expect(out.summary).toBe("update_available");
    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.draft_status).toBe("SENT");
    expect(summary.summary_text).toBe("The sent summary.");
    expect(summary.sent_message_id).toBe("msg-9");
    expect(summary.update_available).toBe(true);
    const [readyEvent] = rtTo(U1, "call:summary_ready");
    expect(readyEvent[3].status).toBe("UPDATE_AVAILABLE");
  });

  test("a DISCARDED draft is a decision: the pipeline does not regenerate it behind the caller's back", async () => {
    mockStore.current.calls.set(CALL, endedCall({ transcription_state: "TRANSCRIPTION_FAILED" }));
    mockStore.current.parts.push(part("caller", 1), part("callee", 1));
    mockStore.current.summaries.set(CALL, {
      summary_id: "s1", call_id: CALL, summary_text: "Discarded.", key_points: [], follow_ups: [],
      language: "en", provenance: "groq", draft_status: "DISCARDED", sent_message_id: null,
      update_available: false, update_message_id: null, regenerate_count: 1,
    });
    transcription.transcribe.mockResolvedValue({
      text: "words", audio_seconds: 60, provider: "groq", detected_language: "en",
    });

    const out = await pipeline.processCall(client({ names: NAMES }), { callId: CALL });
    expect(out.summary).toBe("discarded");
    expect(mockStore.current.summaries.get(CALL).summary_text).toBe("Discarded.");
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("a run that is already in flight is not started twice", async () => {
    mockStore.current.calls.set(CALL, endedCall({
      transcription_state: "PROCESSING",
      transcription_updated_at: new Date().toISOString(),
    }));
    const out = await pipeline.processCall(client(), { callId: CALL });
    expect(out).toEqual({ skipped: "in_flight" });
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  test("an ENDED call whose uploads are still arriving waits instead of falling back", async () => {
    mockStore.current.calls.set(CALL, endedCall({ ended_at: new Date(Date.now() - 30_000).toISOString() }));
    // Only the caller has uploaded so far, and the callee's recogniser said
    // nothing either. Both clients are still flushing.
    mockStore.current.parts.push(part("caller", 1));
    const out = await pipeline.processCall(client(), { callId: CALL });
    expect(out.waiting).toBe(true);
    expect(mockStore.current.calls.get(CALL).transcription_state).toBeNull();
  });

  test("a governance refusal is an answer, not a crash: recorded, visible, and retried later", async () => {
    mockStore.current.calls.set(CALL, endedCall());
    mockStore.current.parts.push(part("caller", 1));
    governance.canUseFeature.mockResolvedValue({ allowed: false, reason: "AI budget exhausted" });
    const out = await pipeline.processCall(client(), { callId: CALL, tenantMeta: { slug: "acme" } });
    expect(out.blocked).toBe(true);
    const call = mockStore.current.calls.get(CALL);
    expect(call.transcription_state).toBe("TRANSCRIPTION_FAILED");
    expect(call.transcription_error).toMatch(/budget/i);
    expect(transcription.transcribe).not.toHaveBeenCalled();
    expect(rtTo(U1, "call:transcription_failed")).toHaveLength(1);
  });
});

/* ── The caller's three actions ─────────────────────────────────────────── */

function pendingSummary(over = {}) {
  mockStore.current.summaries.set(CALL, {
    summary_id: "s1",
    call_id: CALL,
    summary_text: "Draft prose.",
    key_points: [{ text: "Livraison confirmée", raised_by: "caller" }],
    follow_ups: [{ text: "Envoyer le BL", owner: "caller", due: "2026-09-30" }],
    language: "en",
    provenance: "groq",
    draft_status: "PENDING_REVIEW",
    sent_message_id: null,
    update_available: false,
    update_message_id: null,
    regenerate_count: 0,
    ...over,
  });
}

describe("sendSummary — the caller's one tap, and no other way in", () => {
  beforeEach(() => {
    mockStore.current.calls.set(CALL, endedCall());
    pendingSummary();
  });

  test("the callee cannot send it", async () => {
    await expect(pipeline.sendSummary(client(), { callId: CALL, actor: callee }))
      .rejects.toMatchObject({ code: "NOT_CALLER", status: 403 });
    expect(smartcomm.postMessage).not.toHaveBeenCalled();
  });

  test("a stranger cannot read the call at all", async () => {
    await expect(pipeline.sendSummary(client(), { callId: CALL, actor: { user_id: "99999999-9999-9999-9999-999999999999" } }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  test("the caller's edit is what is posted, as a normal message with a CALL attachment", async () => {
    const out = await pipeline.sendSummary(client(), {
      callId: CALL,
      actor: caller,
      summaryText: "Prose the caller edited.",
      keyPoints: [{ text: "Point un", raised_by: "callee" }],
      followUps: [],
    });

    const [, posted] = smartcomm.postMessage.mock.calls[0];
    expect(posted.groupId).toBe(GROUP);
    expect(posted.body).toBe("Prose the caller edited.");
    expect(posted.actor.user_id).toBe(U1);
    expect(posted.attachments).toEqual([expect.objectContaining({ attachment_kind: "CALL", call_id: CALL })]);

    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.draft_status).toBe("SENT");
    expect(summary.sent_message_id).toBe("msg-1");
    expect(summary.summary_text).toBe("Prose the caller edited.");
    expect(out.draft_status).toBe("SENT");
  });

  test("an edit that breaks the shared schema is refused, and nothing is posted", async () => {
    await expect(pipeline.sendSummary(client(), {
      callId: CALL,
      actor: caller,
      summaryText: "x".repeat(1201),
    })).rejects.toBeTruthy();
    expect(smartcomm.postMessage).not.toHaveBeenCalled();
  });

  test("a sent summary cannot be sent again — only the offered update can", async () => {
    await expect(pipeline.sendSummary(client(), { callId: CALL, actor: caller })).resolves.toBeTruthy();
    await expect(pipeline.sendSummary(client(), { callId: CALL, actor: caller }))
      .rejects.toMatchObject({ code: "SUMMARY_ALREADY_SENT", status: 409 });
    expect(smartcomm.postMessage).toHaveBeenCalledTimes(1);
  });

  test("with an update offered, the second post is clearly labelled and does not rewrite the first", async () => {
    pendingSummary({ draft_status: "SENT", sent_message_id: "msg-first", update_available: true });
    const out = await pipeline.sendSummary(client(), { callId: CALL, actor: caller, summaryText: "Cleaner prose." });
    expect(out.is_update).toBe(true);
    const [, posted] = smartcomm.postMessage.mock.calls[0];
    expect(posted.body).toContain("Updated call summary");
    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.sent_message_id).toBe("msg-first");
    expect(summary.update_message_id).toBe("msg-1");
    expect(summary.update_available).toBe(false);
  });

  test("a discarded draft cannot be sent", async () => {
    pendingSummary({ draft_status: "DISCARDED" });
    await expect(pipeline.sendSummary(client(), { callId: CALL, actor: caller }))
      .rejects.toMatchObject({ code: "SUMMARY_DISCARDED", status: 409 });
  });
});

describe("regenerateSummary — the EN/FR toggle on a draft only", () => {
  beforeEach(() => {
    mockStore.current.calls.set(CALL, endedCall());
    mockStore.current.parts.push(part("caller", 1), part("callee", 1));
    mockStore.current.transcripts.push({
      transcript_id: "t1", call_id: CALL, side: "caller", part_index: 1,
      text: "bonjour", language: "fr", provider: "groq", certified: true, is_current: true,
    });
    pendingSummary();
    llm.chat.mockResolvedValue({
      provider: "deepseek",
      text: JSON.stringify({ summary: "Le résumé en français.", key_points: [], follow_ups: [] }),
    });
  });

  test("flipping to FR redrafts the prose, keeps the quotations verbatim, and counts the flip", async () => {
    const out = await pipeline.regenerateSummary(client({ names: NAMES }), { callId: CALL, actor: caller, language: "fr" });
    expect(out.language).toBe("fr");
    expect(out.summary.summary_text).toBe("Le résumé en français.");
    const summary = mockStore.current.summaries.get(CALL);
    expect(summary.regenerate_count).toBe(1);
    expect(summary.draft_status).toBe("PENDING_REVIEW");
    // Still the same record: nothing here posts a message.
    expect(smartcomm.postMessage).not.toHaveBeenCalled();
  });

  test("the callee cannot regenerate it", async () => {
    await expect(pipeline.regenerateSummary(client(), { callId: CALL, actor: callee, language: "fr" }))
      .rejects.toMatchObject({ code: "NOT_CALLER", status: 403 });
  });

  test("a sent summary is not regenerated", async () => {
    pendingSummary({ draft_status: "SENT", sent_message_id: "msg-1" });
    await expect(pipeline.regenerateSummary(client(), { callId: CALL, actor: caller, language: "fr" }))
      .rejects.toMatchObject({ code: "SUMMARY_NOT_PENDING_REVIEW", status: 409 });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("only EN and FR exist; anything else is a 422, not a silent English draft", async () => {
    await expect(pipeline.regenerateSummary(client(), { callId: CALL, actor: caller, language: "es" }))
      .rejects.toMatchObject({ code: "BAD_LANGUAGE", status: 422 });
  });
});

/* ── Retention, reads and the enqueue ───────────────────────────────────── */

describe("retention (D7)", () => {
  test("audio past the window is deleted, and only then marked purged", async () => {
    mockStore.current.parts.push(part("caller", 1, { age: 31 }), part("caller", 2, { age: 3 }));
    const out = await pipeline.purgeExpiredAudio(client(), { days: 30 });
    expect(out).toEqual({ due: 1, purged: 1, failed: 0 });
    expect(storage.delete).toHaveBeenCalledWith(mockStore.current.parts[0].vault_ref);
    expect(mockStore.current.parts[0].purged_at).toBeTruthy();
    expect(mockStore.current.parts[1].purged_at).toBeNull();
    // The row and its transcript stay: the text is the record.
    expect(mockStore.current.parts[0].vault_ref).toBeTruthy();
  });

  test("a part whose delete failed is NOT marked purged — marking first would leak it forever", async () => {
    mockStore.current.parts.push(part("caller", 1, { age: 31 }));
    storage.delete.mockRejectedValue(new Error("S3 unavailable"));
    const out = await pipeline.purgeExpiredAudio(client(), { days: 30 });
    expect(out).toEqual({ due: 1, purged: 0, failed: 1 });
    expect(mockStore.current.parts[0].purged_at).toBeNull();
  });
});

describe("reads", () => {
  test("the transcript is current rows only, and says whether it is certified", async () => {
    mockStore.current.calls.set(CALL, endedCall({ transcription_state: "TRANSCRIPTION_FAILED" }));
    mockStore.current.transcripts.push(
      { transcript_id: "t1", call_id: CALL, side: "caller", part_index: 1, text: "flagged", language: "en", provider: "browser-live", certified: false, is_current: true },
      { transcript_id: "t2", call_id: CALL, side: "caller", part_index: 2, text: "old", language: "en", provider: "browser-live", certified: false, is_current: false },
    );
    const out = await pipeline.getTranscript(client({ names: NAMES }), { callId: CALL, actor: callee });
    expect(out.certified).toBe(false);
    expect(out.provenance).toBe("browser-live");
    expect(out.parts).toHaveLength(1);
    expect(out.text).toContain("[en] flagged");
  });

  test("the summary read tells the client whether recording is on, and who may act", async () => {
    mockStore.current.calls.set(CALL, endedCall());
    pendingSummary();
    const forCaller = await pipeline.getSummary(client(), { callId: CALL, actor: caller });
    expect(forCaller.is_caller).toBe(true);
    expect(forCaller.recording_enabled).toBe(true);
    expect(forCaller.summary.draft_status).toBe("PENDING_REVIEW");
    const forCallee = await pipeline.getSummary(client(), { callId: CALL, actor: callee });
    expect(forCallee.is_caller).toBe(false);
    const off = await pipeline.getSummary(client({ featureState: "off" }), { callId: CALL, actor: caller });
    expect(off.recording_enabled).toBe(false);
  });
});

describe("startPipeline", () => {
  test("enqueues one deduplicated job per call, delayed for the hang-up flush", async () => {
    await pipeline.startPipeline({ callId: CALL, tenantMeta: { slug: "acme" }, env: "live", delayMs: 20_000 });
    const [name, jobName, data, opts] = enqueue.mock.calls[0];
    expect(name).toBe("call-transcribe");
    expect(jobName).toBe("transcribe");
    expect(data.callId).toBe(CALL);
    expect(opts.jobId).toBe(`calltranscribe-${CALL}`);
    expect(opts.delay).toBe(20_000);
  });

  test("a queue outage never turns a clean hang-up into an error the user sees", async () => {
    enqueue.mockRejectedValueOnce(new Error("redis down"));
    await expect(pipeline.startPipeline({ callId: CALL })).resolves.toBeNull();
  });
});
