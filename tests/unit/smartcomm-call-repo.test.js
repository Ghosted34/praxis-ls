"use strict";
/**
 * The call repo's SQL-level promises from the calls audit: the closed
 * end-reason set (B1), the sweep reads that restart only work that never ran
 * (B4, B5, O1), part uploads and results (A3, B11, B12), the guarded draft
 * writes (B6, B7), the side declaration (A2), the atomic notification claim
 * (A4), the pinned-draft read (O3) and the call list's summary columns (A6).
 */
const repo = require("../../src/modules/smartcomm/smartcomm.call.repo");

function recordingClient(rows = [{ ok: true }]) {
  const seen = [];
  return {
    seen,
    query: async (text, params) => {
      seen.push({ text: String(text), params });
      return { rows, rowCount: rows.length };
    },
  };
}

describe("end reasons (B1)", () => {
  test("'disconnected' is accepted: the liveness sweep's reason is part of the set", async () => {
    const c = recordingClient();
    await repo.transition(c, {
      callId: "c1", fromStatus: "IN_CALL", status: "ENDED", fields: { end_reason: "disconnected" },
    });
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0].params).toContain("disconnected");
  });

  test("a reason outside the set is refused before any SQL, as the CHECK did", async () => {
    const c = recordingClient();
    await expect(repo.transition(c, {
      callId: "c1", fromStatus: "IN_CALL", status: "ENDED", fields: { end_reason: "rage_quit" },
    })).rejects.toThrow(/end reason/);
    expect(c.seen).toHaveLength(0);
  });

  test("a transition that sets no end reason is unaffected", async () => {
    const c = recordingClient();
    await repo.transition(c, {
      callId: "c1", fromStatus: "RINGING", status: "IN_CALL", fields: { connected_at: "2026-09-24T10:00:00Z" },
    });
    expect(c.seen).toHaveLength(1);
  });
});

describe("the sweep's reads: only work that never ran (B4, B5, O1)", () => {
  test("finalise candidates exclude calls that never connected, and are capped on every branch", async () => {
    const c = recordingClient([]);
    await repo.listUnfinalisedCalls(c, { maxAttempts: 5 });
    const sql = c.seen[0].text;
    expect(sql).toMatch(/\(status = 'ENDED' OR connected_at IS NOT NULL\)/);
    // The cap applies to the stale-PROCESSING branch too (B4: it had none).
    expect(sql).toMatch(/AND transcription_attempts < \$1\s+AND \(/);
    // A failed transcript is not retried automatically (O1).
    expect(sql).not.toMatch(/TRANSCRIPTION_FAILED/);
    expect(c.seen[0].params[0]).toBe(5);
  });

  test("stalled parts are PENDING only, within their run cap, never FAILED", async () => {
    const c = recordingClient([]);
    await repo.listStalledParts(c, { staleMinutes: 10, maxRuns: 3 });
    const sql = c.seen[0].text;
    expect(sql).toMatch(/transcript_status = 'PENDING'/);
    expect(sql).not.toMatch(/'FAILED'/);
    expect(sql).toMatch(/job_runs < \$2/);
  });

  test("a part claim is atomic: PENDING, unclaimed or stale, and under the cap", async () => {
    const c = recordingClient([]);
    expect(await repo.claimPart(c, { recordingId: "r1", staleMinutes: 10, maxRuns: 3 })).toBeNull();
    const sql = c.seen[0].text;
    expect(sql).toMatch(/SET transcribe_started_at = now\(\), job_runs = job_runs \+ 1/);
    expect(sql).toMatch(/transcript_status = 'PENDING'/);
    expect(sql).toMatch(/job_runs < \$3/);
  });

  test("a part result only lands on a PENDING part", async () => {
    const c = recordingClient([]);
    await repo.setPartResult(c, { recordingId: "r1", status: "OK", attempts: 1, provider: "groq" });
    expect(c.seen[0].text).toMatch(/WHERE recording_id = \$1 AND transcript_status = 'PENDING'/);
  });
});

describe("recorded parts (A3, B11, B12)", () => {
  test("a re-upload replaces only a PENDING part; a part with a result is left alone", async () => {
    const c = recordingClient([]);
    const out = await repo.upsertRecordingPart(c, {
      callId: "c1", side: "caller", partIndex: 1, partCount: 1, vaultRef: "k", mediaType: "audio/webm", sizeBytes: 10, durationSeconds: 120,
    });
    expect(out).toBeNull();
    expect(c.seen[0].text).toMatch(/WHERE comms_call_recording\.transcript_status = 'PENDING'/);
  });

  test("a part may run to 125 s (the CHECK 14050 dropped said 120) and no further", async () => {
    const c = recordingClient();
    const part = (durationSeconds) => ({
      callId: "c1", side: "caller", partIndex: 1, partCount: 1, vaultRef: "k", mediaType: "audio/webm", sizeBytes: 10, durationSeconds,
    });
    await expect(repo.upsertRecordingPart(c, part(125))).resolves.toBeTruthy();
    await expect(repo.upsertRecordingPart(c, part(126))).rejects.toThrow(/duration/);
    expect(c.seen).toHaveLength(1);
  });
});

describe("transcript rows (B4)", () => {
  test("inserting a part retires whatever row is current for it, whatever its provider", async () => {
    const c = recordingClient([]);
    await repo.insertTranscriptRows(c, {
      callId: "c1", side: "caller", rows: [{ partIndex: 1, text: "hi", language: "en", provider: "gemini", certified: true }],
    });
    const retire = c.seen.find((q) => /SET is_current = false/.test(q.text));
    expect(retire.text).not.toMatch(/browser-live/);
    expect(retire.text).toMatch(/part_index = ANY\(\$3::int\[\]\) AND is_current/);
  });
});

describe("the summary draft (B6, B7)", () => {
  const draft = {
    callId: "c1", summaryText: "s", keyPoints: [], followUps: [], language: "en", provenance: "groq",
  };

  test("the upsert only overwrites a draft that is still PENDING_REVIEW", async () => {
    const c = recordingClient([]);
    expect(await repo.upsertSummaryDraft(c, draft)).toBeNull();
    const sql = c.seen[0].text;
    expect(sql).toMatch(/WHERE comms_call_summary\.draft_status = 'PENDING_REVIEW'/);
    // It no longer forces the status back to PENDING_REVIEW.
    expect(sql).not.toMatch(/draft_status\s*=\s*'PENDING_REVIEW',/);
  });

  test("a send claims PENDING_REVIEW → SENDING, and only SENDING becomes SENT", async () => {
    const c = recordingClient([]);
    await repo.claimDraftForSend(c, { callId: "c1", summaryText: "s", keyPoints: [], followUps: [] });
    expect(c.seen[0].text).toMatch(/SET draft_status = 'SENDING'/);
    expect(c.seen[0].text).toMatch(/WHERE call_id = \$1 AND draft_status = 'PENDING_REVIEW'/);
    await repo.markSummarySent(c, { callId: "c1", messageId: "m1" });
    expect(c.seen[1].text).toMatch(/WHERE call_id = \$1 AND draft_status = 'SENDING'/);
  });

  test("an update send claims the offer, so it can be posted once", async () => {
    const c = recordingClient([]);
    await repo.claimUpdateForSend(c, { callId: "c1", summaryText: "s", keyPoints: [], followUps: [] });
    expect(c.seen[0].text).toMatch(/SET update_available = false/);
    expect(c.seen[0].text).toMatch(/draft_status = 'SENT' AND update_available/);
  });
});

describe("the side declaration (A2)", () => {
  test("the first count stands: a different count later matches nothing", async () => {
    const c = recordingClient([]);
    expect(await repo.declareSide(c, { callId: "c1", side: "callee", parts: 3 })).toBeNull();
    expect(c.seen[0].text).toMatch(/SET callee_parts_declared = \$2/);
    expect(c.seen[0].text).toMatch(/callee_parts_declared IS NULL OR callee_parts_declared = \$2/);
  });

  test("a side outside the two is refused before any SQL", async () => {
    const c = recordingClient();
    await expect(repo.declareSide(c, { callId: "c1", side: "both", parts: 1 })).rejects.toThrow(/side/);
    expect(c.seen).toHaveLength(0);
  });
});

describe("the pinned draft read (O3)", () => {
  test("only the caller's pending drafts in this conversation, and only with recording on", async () => {
    const c = recordingClient([]);
    await repo.pendingDraftsInChannel(c, { groupId: "g1", userId: "u1" });
    const sql = c.seen[0].text;
    expect(sql).toMatch(/c\.group_id = \$1 AND c\.caller_id = \$2 AND s\.draft_status = 'PENDING_REVIEW'/);
    expect(sql).toMatch(/feature_key = 'call_recording' AND f\.state = 'on'/);
  });
});

describe("the notification claim (A4)", () => {
  test("claims notified_at only while it is still NULL", async () => {
    const c = recordingClient();
    const out = await repo.claimSummaryNotification(c, "c1");
    expect(out).toBeTruthy();
    expect(c.seen[0].text).toMatch(/SET notified_at = now\(\)/);
    expect(c.seen[0].text).toMatch(/notified_at IS NULL/);
    expect(c.seen[0].params).toEqual(["c1"]);
  });

  test("a lost claim returns null", async () => {
    const c = recordingClient([]);
    expect(await repo.claimSummaryNotification(c, "c1")).toBeNull();
  });
});

describe("the call list (A6, E14)", () => {
  test("carries the transcription state and the summary's status for the badges", async () => {
    const c = recordingClient([]);
    await repo.listCallsForUser(c, "u1");
    const sql = c.seen[0].text;
    expect(sql).toMatch(/c\.\*/);
    expect(sql).toMatch(/LEFT JOIN comms_call_summary s ON s\.call_id = c\.call_id/);
    expect(sql).toMatch(/s\.draft_status/);
    expect(sql).toMatch(/s\.notified_at/);
  });
});

describe("the call read (A6)", () => {
  test("carries the summary's status, so the call page can show a draft even on a call later marked NO_RECORDING", async () => {
    const service = require("../../src/modules/smartcomm/smartcomm.call.service");
    const seen = [];
    const c = {
      query: async (text, params) => {
        seen.push(String(text));
        if (/SELECT 1 AS ok FROM comms_call/.test(text)) return { rows: [{ ok: 1 }] };
        if (/FROM feature_state/.test(text)) return { rows: [{ state: "on" }] };
        return { rows: [{ call_id: params[0], draft_status: "PENDING_REVIEW" }] };
      },
    };
    const call = await service.getCall(c, { id: "c1", actor: { user_id: "u1" } });
    expect(call.draft_status).toBe("PENDING_REVIEW");
    const detail = seen.find((q) => /FROM comms_call c/.test(q));
    expect(detail).toMatch(/LEFT JOIN comms_call_summary s ON s\.call_id = c\.call_id/);
    expect(detail).toMatch(/s\.draft_status/);
  });
});
