/**
 * Rolling conversation summary (0481).
 *
 * The replay window caps what is re-sent to the model so per-call cost stays flat
 * against a hard-capped AI budget. The side effect was that turn 21 did not fade,
 * it vanished. These guard the boundary conditions of the fold-forward:
 *
 *   - the batch must exclude the messages still being replayed verbatim, or the
 *     prompt carries them twice;
 *   - it must resume exactly at `summary_through`, or a message is summarised
 *     twice (or skipped entirely);
 *   - the summary is REPLACED, never appended — an appended summary grows without
 *     bound and recreates the cost problem the window exists to solve.
 */
"use strict";

const repo = require("../../src/modules/ai/assistant/assistant.repo");

const CONV = "9c1f0a10-0000-4000-8000-0000000000aa";
const MSG = "9c1f0a10-0000-4000-8000-0000000000bb";

function fakeClient(rows = []) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return { rows };
    }),
  };
}

describe("messagesAwaitingSummary", () => {
  it("excludes the messages still inside the replay window", async () => {
    const c = fakeClient();
    await repo.messagesAwaitingSummary(c, CONV, {
      keepRecent: 20,
      sinceMessageId: null,
    });
    const { sql, params } = c.queries[0];
    // rn > keepRecent is what skips the replayed tail.
    expect(sql).toContain("r.rn > $2");
    expect(params[1]).toBe(20);
  });

  it("resumes after the message the summary already covers", async () => {
    const c = fakeClient();
    await repo.messagesAwaitingSummary(c, CONV, {
      keepRecent: 20,
      sinceMessageId: MSG,
    });
    const { sql, params } = c.queries[0];
    expect(params[2]).toBe(MSG);
    // Row comparison, not a bare timestamp — two messages can share a millisecond.
    expect(sql).toContain("(r.created_at, r.ai_message_id) >");
  });

  it("takes everything when there is no summary yet", async () => {
    const c = fakeClient();
    await repo.messagesAwaitingSummary(c, CONV, { keepRecent: 20 });
    const { sql, params } = c.queries[0];
    expect(params[2]).toBeNull();
    // With no mark row the predicate must not silently exclude every message.
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM mark)");
  });

  it("returns oldest-first — a transcript reads in the order it happened", async () => {
    const c = fakeClient();
    await repo.messagesAwaitingSummary(c, CONV, {});
    expect(c.queries[0].sql).toContain("ORDER BY r.created_at ASC");
  });

  it("replays only real conversation turns, not tool or system rows", async () => {
    const c = fakeClient();
    await repo.messagesAwaitingSummary(c, CONV, {});
    expect(c.queries[0].sql).toContain("role IN ('user','assistant')");
  });
});

describe("setSummary", () => {
  it("replaces rather than appends, and advances the watermark together", async () => {
    const c = fakeClient();
    await repo.setSummary(c, CONV, {
      summary: "condensed",
      throughMessageId: MSG,
    });
    const { sql, params } = c.queries[0];
    expect(sql).toContain("SET summary = $2");
    expect(sql).not.toMatch(/summary\s*\|\|/); // no concatenation
    expect(sql).toContain("summary_through = $3");
    expect(params).toEqual([CONV, "condensed", MSG]);
  });

  it("normalises a missing watermark to null rather than undefined", async () => {
    const c = fakeClient();
    await repo.setSummary(c, CONV, { summary: "x" });
    expect(c.queries[0].params[2]).toBeNull();
  });
});

describe("conversationSummary", () => {
  it("degrades to an empty state rather than undefined when the row is gone", async () => {
    const c = fakeClient([]);
    await expect(repo.conversationSummary(c, CONV)).resolves.toEqual({
      summary: null,
      summary_through: null,
      summary_at: null,
    });
  });
});
