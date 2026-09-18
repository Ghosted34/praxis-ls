"use strict";
/**
 * Audit remediation PR 4 — steering, modes & context window.
 *
 *   D2 / F2 — learning signals are per-USER, not tenant-wide. `recentPatterns`
 *             and `recentNegativeFeedback` must filter on `user_id`, so one
 *             user's actions/feedback never land in another user's prompt.
 *   D4      — tool scoping scores by TOKEN-SET membership, not substring, so a
 *             query token like "add" no longer matches a tool that only contains
 *             "address" (and "is" no longer matches "list").
 *   D3      — the replay window is larger and configurable, and the rolling
 *             summary is STRUCTURED (decisions / figures / records / open),
 *             preserving figures and record references rather than a prose blur.
 */

const orchestrator = require("../../src/services/ai/orchestrator.service");
const { config } = require("../../src/config/env");

const {
  recentPatterns,
  recentNegativeFeedback,
  selectTools,
  tokenize,
  summarySystemPrompt,
} = orchestrator;

// A client that records every SQL + params and answers with canned rows — the
// same shape ai-conversation-summary.test.js uses.
function fakeClient(rows = []) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    }),
  };
}

const USER = "11111111-1111-1111-1111-111111111111";

// ── D2 / F2: learning signals are scoped to the caller ──────────────────────
describe("recentPatterns is per-user (audit D2 / privacy F2)", () => {
  it("filters ai_action_run by the caller's user_id, passed as a bound param", async () => {
    const c = fakeClient([]);
    await recentPatterns(c, USER);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].sql).toContain("user_id = $1");
    expect(c.calls[0].sql).toContain("FROM ai_action_run");
    expect(c.calls[0].params).toEqual([USER]);
  });

  it("returns nothing AND issues no query when there is no caller id (never leaks tenant-wide)", async () => {
    const c = fakeClient([{ action_key: "create_client", proposed_payload: { x: 1 }, executed_entity_ref: "r" }]);
    expect(await Promise.all([undefined, null, ""].map((id) => recentPatterns(c, id)))).toEqual([[], [], []]);
    expect(c.query).not.toHaveBeenCalled();
  });

  it("de-duplicates identical action+field-shape rows to one template", async () => {
    const c = fakeClient([
      { action_key: "create_client", proposed_payload: { name: "A", tier: "gold" }, executed_entity_ref: "r1" },
      { action_key: "create_client", proposed_payload: { name: "B", tier: "silver" }, executed_entity_ref: "r2" },
      { action_key: "open_dossier", proposed_payload: { client_id: "u" }, executed_entity_ref: "r3" },
    ]);
    const out = await recentPatterns(c, USER);
    expect(out.map((p) => p.action)).toEqual(["create_client", "open_dossier"]);
  });

  it("caps the number of injected patterns", async () => {
    const rows = [];
    for (let i = 0; i < 24; i++) rows.push({ action_key: `act_${i}`, proposed_payload: { f: i }, executed_entity_ref: `r${i}` });
    const out = await recentPatterns(fakeClient(rows), USER);
    expect(out.length).toBeLessThanOrEqual(8);
  });
});

describe("recentNegativeFeedback is per-user (audit D2 / privacy F2)", () => {
  it("filters ai_answer_feedback by the caller's user_id, and keeps the citext[] cast", async () => {
    const c = fakeClient([]);
    await recentNegativeFeedback(c, USER);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].sql).toContain("user_id = $1");
    expect(c.calls[0].sql).toContain("FROM ai_answer_feedback");
    // node-postgres cannot parse citext[]; the cast must survive (check-citext-arrays.js).
    expect(c.calls[0].sql).toContain("action_keys::text[]");
    expect(c.calls[0].params).toEqual([USER]);
  });

  it("returns nothing AND issues no query when there is no caller id", async () => {
    const c = fakeClient([{ comment: "x", action_keys: ["a"] }]);
    expect(await recentNegativeFeedback(c, undefined)).toEqual([]);
    expect(c.query).not.toHaveBeenCalled();
  });

  it("de-duplicates the same complaint (case-insensitive) and caps the count", async () => {
    const c = fakeClient([
      { comment: "wrong account number", action_keys: ["a"] },
      { comment: "Wrong Account Number", action_keys: ["b"] },
      { comment: "missed the débours", action_keys: ["c"] },
    ]);
    const out = await recentNegativeFeedback(c, USER);
    expect(out.map((f) => f.comment)).toEqual(["wrong account number", "missed the débours"]);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});

// ── D4: token-boundary tool scoring ─────────────────────────────────────────
describe("tokenize — whole-word tokens with domain synonyms (audit D4)", () => {
  it("keeps short words whole and never folds 'address' toward 'add'", () => {
    const q = tokenize("please add a note");
    expect(q.has("add")).toBe(true);
    expect(q.has("address")).toBe(false);
  });

  it("expands an abbreviation to its full multi-word key parts", () => {
    const q = tokenize("create a PO for supplier X");
    expect(q.has("purchase")).toBe(true);
    expect(q.has("order")).toBe(true);
  });

  it("folds a naive plural so 'invoices' matches a singular 'invoice' token", () => {
    expect(tokenize("show invoices").has("invoice")).toBe(true);
    expect(tokenize("the invoice").has("invoice")).toBe(true);
  });
});

describe("selectTools scores by token boundary, not substring (audit D4)", () => {
  // Enough filler to exceed TOOL_LIMIT (64) so scoring actually runs.
  const filler = () => {
    const t = [];
    for (let i = 0; i < 70; i++) t.push({ action_key: `filler_${i}`, title: `Filler ${i}`, description: "", is_write: false });
    return t;
  };
  const ADDRESS = { action_key: "update_client_address", title: "Update client address", description: "Change a client's postal address", is_write: true };
  const ADD_NOTE = { action_key: "add_note", title: "Add a note", description: "Attach a note to a record", is_write: true };

  it("a query with 'add' does NOT pull a tool that only contains 'address'", () => {
    const tools = [...filler(), ADDRESS, ADD_NOTE];
    const keys = selectTools(tools, "please add a note to this record").map((t) => t.action_key);
    expect(keys).toContain("add_note"); // genuine whole-word hit
    expect(keys).not.toContain("update_client_address"); // spurious substring hit is gone
  });

  it("still retains the CORE tools regardless of the query, and returns at most TOOL_LIMIT", () => {
    const core = { action_key: "list_final_invoices", title: "List final invoices", description: "", is_write: false };
    const tools = [...filler(), core];
    const picked = selectTools(tools, "something totally unrelated to invoicing");
    expect(picked.length).toBeLessThanOrEqual(64);
    expect(picked.map((t) => t.action_key)).toContain("list_final_invoices");
  });

  it("returns the whole list untouched when it already fits under the limit", () => {
    const tools = [{ action_key: "a", title: "A", is_write: false }, { action_key: "b", title: "B", is_write: false }];
    expect(selectTools(tools, "anything")).toBe(tools);
  });
});

// ── D3: wider, configurable window + structured summary ─────────────────────
describe("context window is larger and configurable (audit D3)", () => {
  it("exposes an integer replay-window knob, wider than the legacy 20", () => {
    expect(Number.isInteger(config.AI_HISTORY_TURNS)).toBe(true);
    expect(config.AI_HISTORY_TURNS).toBeGreaterThan(20);
  });

  it("exposes an integer summary-word knob, wider than the legacy 200", () => {
    expect(Number.isInteger(config.AI_SUMMARY_WORDS)).toBe(true);
    expect(config.AI_SUMMARY_WORDS).toBeGreaterThan(200);
  });
});

describe("summarySystemPrompt is structured and preserves figures/records (audit D3)", () => {
  it("names the fixed sections and demands verbatim figures and references", () => {
    const p = summarySystemPrompt();
    for (const heading of ["DECISIONS", "FIGURES", "RECORDS", "OPEN"]) expect(p).toContain(heading);
    expect(p).toMatch(/STRUCTURED/);
    expect(p).toMatch(/verbatim/i);
    expect(p).toMatch(/EXACTLY/); // figures/records copied exactly, not paraphrased
  });

  it("carries the configured word cap so the summary stays bounded", () => {
    expect(summarySystemPrompt(123)).toContain("123");
    expect(summarySystemPrompt()).toContain(String(config.AI_SUMMARY_WORDS));
  });
});
