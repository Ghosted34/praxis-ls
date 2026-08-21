/**
 * THREAD SUMMARIES AND THEIR TRIGGER (§8.5, §8.9).
 *
 * `email_thread_summary` (migration 10750) carried a `language`, a `summary`
 * and — the interesting column — `message_count_at_generation`, and was read
 * and written by nothing. So there was no summary, no five-message trigger, and
 * no `thread.summary` slot for the reading pane.
 *
 * `message_count_at_generation` is the design: the row knows how stale it is,
 * so nothing has to remember to invalidate it. These tests are mostly about
 * that column doing its job, because the alternative — summarising on every
 * open — costs a model call per read of every long thread in the mailbox, and
 * is the version of this feature a finance lead switches off in week two.
 *
 * The second half covers §8.9's search-by-meaning, where the load-bearing part
 * is not the embedding but the RE-FILTER: vector hits are candidates, and every
 * one is re-read through `triage/visibility`'s single §9.5 predicate before it
 * is returned. An embedding layer that decided who sees a thread would be a
 * leak with no audit trail and no obvious symptom.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  chat: jest.fn(async () => ({ provider: "deepseek", text: "They want the container released.", usage: {} })),
  PRIMARY: "deepseek", FALLBACK: "gemini",
}));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ allowed: true })),
  recordUsage: jest.fn(async () => ({})),
}));
jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(async () => []),
  getUserScopeClosure: jest.fn(async () => []),
}));
jest.mock("../../src/services/ai/ingest.service", () => ({
  ingestTenantCards: jest.fn(async () => ({ cards: 1 })),
}));
jest.mock("../../src/services/ai/retrieval.service", () => ({
  retrieve: jest.fn(async () => []),
}));

const fs = require("fs");
const path = require("path");
const llm = require("../../src/services/ai/llm.service");
const governance = require("../../src/modules/ai/governance/governance.service");
const ingest = require("../../src/services/ai/ingest.service");
const retrieval = require("../../src/services/ai/retrieval.service");
const assist = require("../../src/modules/mail/assist/assist.service");
const semantic = require("../../src/modules/mail/assist/semantic.service");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    written: (re) => calls.filter((c) => re.test(c.text)),
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const ON = { match: /FROM feature_state WHERE feature_key = 'mail\.ai'/, rows: [{ state: "on" }] };
const THREAD = {
  match: /FROM email_thread t/,
  rows: [{ email_thread_id: "t-1", subject: "Container release", entity_ref: null, client_language: "en" }],
};
const COUNT = (n) => ({ match: /count\(\*\)::int AS n FROM email_message/, rows: [{ n }] });
const CACHED = (over = {}) => ({
  match: /SELECT \* FROM email_thread_summary/,
  rows: [{
    email_thread_id: "t-1", language: "en", summary: "Old summary.",
    message_count_at_generation: 6, ...over,
  }],
});
const MSGS = {
  match: /FROM email_message\s+WHERE email_thread_id/,
  rows: [{ email_message_id: "m-1", direction: "IN", from_address: "t@camrail.cm", body_text: "Release it." }],
};
const SAVED = {
  match: /INSERT INTO email_thread_summary/,
  rows: [{ email_thread_id: "t-1", language: "en", summary: "They want the container released.", message_count_at_generation: 12 }],
};

const ME = { user_id: "u-me", role_ids: ["r-1"] };

beforeEach(() => {
  jest.clearAllMocks();
  governance.canUseFeature.mockResolvedValue({ allowed: true });
  llm.chat.mockResolvedValue({ provider: "deepseek", text: "They want the container released.", usage: {} });
});

/* ── The trigger ──────────────────────────────────────────────────────────── */

describe("summaries start at five messages and refresh every five after", () => {
  test("the trigger is five, and it is stated once", () => {
    expect(assist.SUMMARY_TRIGGER).toBe(5);
  });

  test("a short thread is not summarised, and is told so plainly", async () => {
    const out = await assist.summary(fakeClient([ON, THREAD, COUNT(2)]), { threadId: "t-1" }, ME);
    expect(out.not_needed).toBe(true);
    expect(out.note).toMatch(/Summaries start at 5 messages\. This thread has 2\./);
    // Rather than spending a model call on a two-message thread the operator
    // can read faster than we can summarise it.
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("a long thread with no summary generates one", async () => {
    const c = fakeClient([ON, THREAD, COUNT(12), MSGS, SAVED]);
    const out = await assist.summary(c, { threadId: "t-1" }, ME);
    expect(llm.chat).toHaveBeenCalled();
    expect(out.summary).toBe("They want the container released.");
    expect(c.written(/INSERT INTO email_thread_summary/)[0].params[3]).toBe(12);
  });

  test("a fresh summary is served from the row, not regenerated", async () => {
    const out = await assist.summary(
      fakeClient([ON, THREAD, COUNT(8), CACHED({ message_count_at_generation: 6 })]), { threadId: "t-1" }, ME);
    expect(out.cached).toBe(true);
    expect(out.stale_by).toBe(2);
    expect(llm.chat).not.toHaveBeenCalled();
    // Summarising on every open costs a model call per read of every long
    // thread in the mailbox.
  });

  test("five more messages make it stale, and it regenerates", async () => {
    const c = fakeClient([ON, THREAD, COUNT(11), CACHED({ message_count_at_generation: 6 }), MSGS, SAVED]);
    await assist.summary(c, { threadId: "t-1" }, ME);
    expect(llm.chat).toHaveBeenCalled();
  });

  test("exactly four more is still fresh — the boundary is checked", async () => {
    await assist.summary(
      fakeClient([ON, THREAD, COUNT(10), CACHED({ message_count_at_generation: 6 })]), { threadId: "t-1" }, ME);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("a summary in the wrong language is regenerated, not translated", async () => {
    const c = fakeClient([ON, THREAD, COUNT(7), CACHED({ language: "fr", message_count_at_generation: 6 }), MSGS, SAVED]);
    await assist.summary(c, { threadId: "t-1", language: "en" }, ME);
    expect(llm.chat).toHaveBeenCalled();
    // A cache keyed on the thread alone would serve a French executive summary
    // to someone who asked for English, and look like it worked.
  });

  test("force regenerates a fresh one", async () => {
    const c = fakeClient([ON, THREAD, COUNT(8), CACHED({ message_count_at_generation: 6 }), MSGS, SAVED]);
    await assist.summary(c, { threadId: "t-1", force: true }, ME);
    expect(llm.chat).toHaveBeenCalled();
  });

  test("the row is upserted, so a thread never has two summaries", async () => {
    const c = fakeClient([ON, THREAD, COUNT(12), MSGS, SAVED]);
    await assist.summary(c, { threadId: "t-1" }, ME);
    const ins = c.written(/INSERT INTO email_thread_summary/)[0];
    expect(ins.text).toMatch(/ON CONFLICT \(email_thread_id\) DO UPDATE/);
    expect(ins.text).toMatch(/generated_at = now\(\)/);
  });

  test("it is metered under its own sub-type", async () => {
    await assist.summary(fakeClient([ON, THREAD, COUNT(12), MSGS, SAVED]), { threadId: "t-1" }, ME);
    expect(governance.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      featureKey: "mail_ai", callType: "summary.thread",
    }));
  });

  test("the thread's own words are fact-fence material for a summary", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "They asked on 2026-08-14.", usage: {} });
    const c = fakeClient([ON, THREAD, COUNT(12), {
      match: /FROM email_message\s+WHERE email_thread_id/,
      rows: [{ direction: "IN", from_address: "t@camrail.cm", body_text: "We wrote on 2026-08-14 about this." }],
    }, SAVED]);
    const out = await assist.summary(c, { threadId: "t-1" }, ME);
    // A date someone wrote in an email is a real thing the summary may repeat,
    // even when no ERP record carries it. Fencing a summary against the ERP
    // alone would flag the correspondence for quoting itself.
    expect(out.needs_review).toBe(false);
  });
});

/* ── Search by meaning ────────────────────────────────────────────────────── */

describe("search by meaning goes through the shared corpus", () => {
  test("a thread is ingested as ONE card, through the shared ingest service", async () => {
    const c = fakeClient([{
      match: /FROM email_thread t/,
      rows: [
        { email_thread_id: "t-1", subject: "Demurrage at Douala", visibility: "COMPANY", direction: "IN", from_address: "t@camrail.cm", body_text: "Storage charges again.", received_at: new Date("2026-03-01") },
        { email_thread_id: "t-1", subject: "Demurrage at Douala", visibility: "COMPANY", direction: "OUT", from_address: "us@praxis.cm", body_text: "We will contest them.", received_at: new Date("2026-03-02") },
      ],
    }]);
    await semantic.ingestThread(c, "t-1");
    expect(ingest.ingestTenantCards).toHaveBeenCalledTimes(1);
    const [cards] = ingest.ingestTenantCards.mock.calls[0].slice(1);
    expect(cards).toHaveLength(1);
    // Per-message cards would return six near-identical hits from the same
    // conversation and push every other thread off the first page.
    expect(cards[0].ref).toBe("email_thread:t-1");
    expect(cards[0].text).toMatch(/Storage charges again/);
    expect(cards[0].text).toMatch(/We will contest them/);
  });

  test("a non-COMPANY thread is tagged restricted in the corpus", async () => {
    const c = fakeClient([{
      match: /FROM email_thread t/,
      rows: [{ email_thread_id: "t-1", subject: "s", visibility: "PRIVATE", direction: "IN", body_text: "x" }],
    }]);
    await semantic.ingestThread(c, "t-1");
    expect(ingest.ingestTenantCards.mock.calls[0][1][0].confidentiality).toBe("restricted");
  });

  test("the tenant's vectorization flag is honoured because the shared service owns it", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/assist/semantic.service.js"), "utf8",
    );
    // Not a mail-specific embedding path: a second one would need its own
    // vectorization gate, its own idempotence and its own dimension agreement
    // with retrieval, and the first time any of the three drifted, mail would
    // be the corpus that silently stopped matching.
    expect(src).toMatch(/require\(".*services\/ai\/ingest\.service"\)/);
    expect(src).not.toMatch(/INSERT INTO ai_chunk/);
  });

  test("an ingest failure never stops a mailbox syncing", async () => {
    const c = { query: async () => { throw new Error("embeddings vendor down"); } };
    const out = await semantic.onThreadUpdated(c, "t-1");
    expect(out.error).toBe(true);
  });

  test("sync calls it", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/mail/mail.service.js"), "utf8",
    );
    expect(src).toMatch(/semantic\.onThreadUpdated\(/);
  });
});

/* ── The re-filter, which is the security half ────────────────────────────── */

describe("vector hits are candidates, and §9.5 decides", () => {
  const hits = (...ids) => ids.map((id, i) => ({ ref: `email_thread:${id}`, sim: 0.9 - i * 0.1, content: "…" }));

  test("every hit is re-read through the visibility predicate", async () => {
    retrieval.retrieve.mockResolvedValue(hits("t-1", "t-2"));
    const c = fakeClient([{ match: /FROM email_thread t/, rows: [{ email_thread_id: "t-1", subject: "s" }] }]);
    await semantic.search(c, { query: "storage charges", userId: "u-me" });
    const q = c.calls[0];
    // The SAME predicate as list, get, timeline and export. A second copy of
    // this rule is a leak; a search that skipped it is a bypass.
    expect(q.text).toMatch(/t\.visibility = 'COMPANY'/);
    expect(q.text).toMatch(/email_thread_share s/);
    expect(q.params[1]).toBe("u-me");
  });

  test("a thread the caller may not see is dropped, and counted", async () => {
    retrieval.retrieve.mockResolvedValue(hits("t-1", "t-2", "t-3"));
    const c = fakeClient([{ match: /FROM email_thread t/, rows: [{ email_thread_id: "t-2", subject: "visible" }] }]);
    const out = await semantic.search(c, { query: "storage", userId: "u-me" });
    expect(out.hits.map((h) => h.email_thread_id)).toEqual(["t-2"]);
    expect(out.withheld).toBe(2);
    // Otherwise a PRIVATE thread becomes readable the moment someone phrases a
    // query that resembles it.
  });

  test("results are ordered by MEANING, not by the database's row order", async () => {
    retrieval.retrieve.mockResolvedValue([
      { ref: "email_thread:t-1", sim: 0.4 },
      { ref: "email_thread:t-2", sim: 0.95 },
    ]);
    const c = fakeClient([{
      match: /FROM email_thread t/,
      rows: [{ email_thread_id: "t-1", subject: "weak" }, { email_thread_id: "t-2", subject: "strong" }],
    }]);
    const out = await semantic.search(c, { query: "storage", userId: "u-me" });
    expect(out.hits[0].email_thread_id).toBe("t-2");
    // The re-filter is a permission check. It must not be allowed to re-rank.
  });

  test("it over-fetches before filtering", async () => {
    retrieval.retrieve.mockResolvedValue([]);
    await semantic.search(fakeClient(), { query: "storage", userId: "u-me", limit: 10 });
    // Asking for 10 and filtering to 2 would look like the feature does not
    // work, when what happened is that eight hits were other people's threads.
    expect(retrieval.retrieve.mock.calls[0][0].k).toBeGreaterThan(10);
  });

  test("non-mail hits in the corpus are ignored", async () => {
    retrieval.retrieve.mockResolvedValue([{ ref: "client:c-1", sim: 0.99 }, { ref: "email_thread:t-1", sim: 0.5 }]);
    const c = fakeClient([{ match: /FROM email_thread t/, rows: [{ email_thread_id: "t-1", subject: "s" }] }]);
    const out = await semantic.search(c, { query: "storage", userId: "u-me" });
    expect(out.hits).toHaveLength(1);
    expect(c.calls[0].params[0]).toEqual(["t-1"]);
  });

  test("no hits means no query against the mailbox at all", async () => {
    retrieval.retrieve.mockResolvedValue([]);
    const c = fakeClient();
    const out = await semantic.search(c, { query: "storage", userId: "u-me" });
    expect(out.hits).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });

  test("an empty query costs nothing", async () => {
    const out = await semantic.search(fakeClient(), { query: "  ", userId: "u-me" });
    expect(out.hits).toEqual([]);
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });
});
