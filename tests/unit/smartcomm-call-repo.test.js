"use strict";
/**
 * The call repo's SQL-level promises for PR-1 of the calls audit: the closed
 * end-reason set now that migration 14040 dropped the CHECK (B1), the reprocess
 * query that no longer selects calls that never connected (B5), the atomic
 * notification claim (A4), and the call list's summary columns (A6/E14).
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

describe("the reprocess query (B5)", () => {
  test("calls that never connected are excluded in SQL", async () => {
    const c = recordingClient([]);
    await repo.listUntranscribedEndedCalls(c, { limit: 25 });
    expect(c.seen[0].text).toMatch(/\(status = 'ENDED' OR connected_at IS NOT NULL\)/);
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
