"use strict";
/**
 * `/ai/ask` returns the grounding, end to end through the orchestrator.
 *
 * The unit tests in `ai-answer-sources.test.js` pin the derivation; this pins the
 * WIRING, which is where the feature was actually lost. The three surfaces that
 * had never rendered depend on two optional fields surviving the whole turn —
 * read execution, the follow-up narration call, history persistence — and
 * arriving on the response object. Dropping them breaks nothing loudly.
 */
const { logger } = require("../../src/config/logger");

jest.mock("../../src/services/ai/llm.service", () => ({ chat: jest.fn() }));
jest.mock("../../src/services/ai/retrieval.service", () => ({
  retrieve: jest.fn(async () => [{ ref: "doc:kb", content: "context" }, { ref: "ui:screen/fin_invoices", content: "screen" }]),
  toContextBlock: () => "CONTEXT",
}));

const llm = require("../../src/services/ai/llm.service");
const orchestrator = require("../../src/services/ai/orchestrator.service");
const registry = require("../../client/src/app/screen-registry.json");

// CEO, so `action-authz` lets the read through without a grant fixture (PRD §3
// — the CEO bypass is the real product rule, not a test shortcut). The denial
// path gets its own case below, with an ordinary user.
const user = { user_id: "11111111-1111-1111-1111-111111111111", is_ceo: true };
const staff = { user_id: "22222222-2222-2222-2222-222222222222", role_ids: [] };
const INVOICES = registry.screens.find((s) => (s.actions || []).includes("list_final_invoices")).route;

/**
 * A tenant client that answers by SQL shape: the gate is open, the catalogue
 * offers one read, and nothing else is asked of it. Conversation persistence
 * returns no rows, which the orchestrator already treats as "history
 * unavailable" — an enhancement, never a reason to fail an answer.
 */
function fakeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM feature_state/.test(sql)) return { rows: [{ state: "on" }] };
      if (/FROM ai_action_catalogue/.test(sql)) {
        return {
          rows: [
            { action_key: "list_final_invoices", title: "list final invoices", description: null, payload_schema: {}, is_write: false, required_permission: null, requires_confirmation: false },
          ],
        };
      }
      return { rows: [] };
    }),
  };
}

const toolCall = (name, args) => ({ id: "call-1", function: { name, arguments: JSON.stringify(args) } });

beforeEach(() => {
  jest.clearAllMocks();
  // The orchestrator logs a warning for every best-effort path this harness
  // deliberately leaves unwired (history, usage). Silenced so a passing run is
  // readable; failures still surface through the assertions.
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("ask() returns grounding derived from the reads it ran", () => {
  it("cites the screen and names the record, without the model writing a link", async () => {
    // The model narrates in exactly the plain business language the system
    // prompt demands: no markdown links, no identifiers. The old derivation
    // (markdown links in prose) finds NOTHING here — that was the bug.
    llm.chat
      .mockResolvedValueOnce({ text: "", toolCalls: [toolCall("list_final_invoices", { status: "OVERDUE", limit: 50 })], provider: "test", usage: {} })
      .mockResolvedValueOnce({ text: "Two invoices are overdue: SBX-INV-0031 and SBX-INV-0044.", toolCalls: [], provider: "test", usage: {} });

    const res = await orchestrator.ask({
      client: fakeClient(),
      user,
      message: "which invoices are overdue?",
      registry: {
        list_final_invoices: async () => ({
          data: [
            { invoice_id: "u-1", doc_number: "SBX-INV-0031" },
            { invoice_id: "u-2", doc_number: "SBX-INV-0044" },
          ],
        }),
      },
    });

    expect(res.answer).not.toMatch(/\]\(/); // no markdown link anywhere in the prose
    expect(res.sources).toEqual([{ label: expect.stringContaining("· 2"), href: INVOICES, kind: "record" }]);
    expect(res.trace).toEqual([
      "Searched the knowledge base — 2 passages recalled",
      "Read final invoices (status: OVERDUE) — 2 records",
    ]);
  });

  it("omits both fields when nothing was read, so the UI shows nothing", async () => {
    llm.chat.mockResolvedValueOnce({ text: "Hello — what can I help with?", toolCalls: [], provider: "test", usage: {} });
    const res = await orchestrator.ask({ client: fakeClient(), user, message: "hello", registry: {} });
    expect(res.sources).toBeUndefined();
    expect(res.trace).toBeUndefined();
  });

  it("traces a refused read instead of letting the answer read as 'nothing found'", async () => {
    // A user with no grant for the action. The whole point of the step: told
    // "no overdue invoices", they can see the read never ran.
    llm.chat
      .mockResolvedValueOnce({ text: "", toolCalls: [toolCall("list_final_invoices", {})], provider: "test", usage: {} })
      .mockResolvedValueOnce({ text: "I could not check that.", toolCalls: [], provider: "test", usage: {} });

    const ran = jest.fn();
    const res = await orchestrator.ask({
      client: fakeClient(),
      user: staff,
      message: "which invoices are overdue?",
      registry: { list_final_invoices: ran },
    });

    expect(ran).not.toHaveBeenCalled();
    expect(res.sources).toBeUndefined(); // a refused read grounds nothing
    expect(res.trace).toEqual([
      expect.stringMatching(/passages recalled/),
      expect.stringMatching(/^Read final invoices — failed: You do not have permission/),
    ]);
  });
});
