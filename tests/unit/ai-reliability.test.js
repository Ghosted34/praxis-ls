"use strict";
/**
 * Audit E2 — the post-confirm auto-continue must be CHEAP. It calls ask() again
 * milliseconds after the turn that just ran, to propose the next step; that
 * follow-up is driven by the conversation and the tools, not by fresh
 * knowledge-base recall, so `ask({ skipRetrieval: true })` skips the embed +
 * vector search (and the rolling-summary condense). These pin that a normal turn
 * still retrieves, and the cheap follow-up does not.
 */
const { logger } = require("../../src/config/logger");

jest.mock("../../src/services/ai/llm.service", () => ({ chat: jest.fn(), chatStream: jest.fn() }));
jest.mock("../../src/services/ai/retrieval.service", () => ({
  retrieve: jest.fn(async () => []),
  toContextBlock: () => "CONTEXT",
}));

const llm = require("../../src/services/ai/llm.service");
const retrieval = require("../../src/services/ai/retrieval.service");
const orchestrator = require("../../src/services/ai/orchestrator.service");

const user = { user_id: "11111111-1111-1111-1111-111111111111", is_ceo: true };

// Gate open, empty catalogue, everything else empty — enough for ask() to run a
// single toolless turn (mirrors ai-ask-grounding.test.js).
function fakeClient() {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM feature_state/.test(sql)) return { rows: [{ state: "on" }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
  llm.chat.mockResolvedValue({ text: "ok", toolCalls: [], provider: "test", usage: {} });
});
afterEach(() => jest.restoreAllMocks());

test("a normal ask() retrieves knowledge-base grounding", async () => {
  await orchestrator.ask({ client: fakeClient(), user, message: "what is overdue?", registry: {} });
  expect(retrieval.retrieve).toHaveBeenCalledTimes(1);
});

test("ask({ skipRetrieval: true }) skips retrieval — the cheap auto-continue path (audit E2)", async () => {
  const res = await orchestrator.ask({
    client: fakeClient(),
    user,
    message: "The previous action was just executed successfully. Propose the next step.",
    registry: {},
    skipRetrieval: true,
  });
  expect(retrieval.retrieve).not.toHaveBeenCalled();
  // It still produces an answer — skipping recall does not break the turn.
  expect(res.answer).toBe("ok");
});
