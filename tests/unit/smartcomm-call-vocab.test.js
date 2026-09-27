"use strict";
/**
 * The call repo enforces the vocabularies that migration 14040 took off the
 * database: transcript provider (and the certified pairing) and summary
 * provenance. A bad value is refused BEFORE any SQL runs, exactly as the
 * CHECK would have refused it.
 */
const repo = require("../../src/modules/smartcomm/smartcomm.call.repo");
const vocab = require("../../src/modules/smartcomm/smartcomm.call.vocab");

function fakeClient() {
  const sql = [];
  return {
    sql,
    query: async (text) => {
      sql.push(String(text));
      return { rows: [{ ok: true }], rowCount: 1 };
    },
  };
}
const inserts = (c) => c.sql.filter((q) => /INSERT INTO comms_call_(transcript|summary)/.test(q));
const row = (over) => ({ partIndex: 1, text: "bonjour", language: "fr", ...over });

describe("transcript rows", () => {
  test("groq and gemini rows are certified; browser-live rows are not", async () => {
    const c = fakeClient();
    await repo.insertTranscriptRows(c, {
      callId: "c1", side: "caller",
      rows: [row({ provider: "groq", certified: true }), row({ partIndex: 2, provider: "gemini", certified: true })],
    });
    expect(inserts(c)).toHaveLength(1);
  });

  test.each([
    ["an unknown provider", { provider: "whisper-local", certified: true }],
    ["certified browser words", { provider: "browser-live", certified: true }],
    ["an uncertified Gemini row", { provider: "gemini", certified: false }],
  ])("%s is refused before any SQL", async (_label, over) => {
    const c = fakeClient();
    await expect(repo.insertTranscriptRows(c, { callId: "c1", side: "caller", rows: [row(over)] }))
      .rejects.toThrow(/transcript row/);
    expect(inserts(c)).toHaveLength(0);
  });
});

describe("summary provenance", () => {
  test.each(vocab.SUMMARY_PROVENANCES)("%s is accepted", async (provenance) => {
    const c = fakeClient();
    await repo.upsertSummaryDraft(c, {
      callId: "c1", summaryText: "x", keyPoints: [], followUps: [], language: "en", provenance,
    });
    expect(inserts(c)).toHaveLength(1);
  });

  test("anything else is refused before any SQL", async () => {
    const c = fakeClient();
    await expect(repo.upsertSummaryDraft(c, {
      callId: "c1", summaryText: "x", keyPoints: [], followUps: [], language: "en", provenance: "whisper",
    })).rejects.toThrow(/provenance/);
    expect(inserts(c)).toHaveLength(0);
  });
});
