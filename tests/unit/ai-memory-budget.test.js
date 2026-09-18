/**
 * THE SUMMARISER MUST NOT BE ABLE TO STALL A TURN.
 * Review 16 Sep 2026 #17 — "memory timeouts".
 *
 * ── WHY A BUDGET, AND WHY HERE ──────────────────────────────────────────────
 *
 * `history_.condense` folds everything past the replay window into a rolling
 * summary, and it deliberately runs BEFORE the model sees the user's question
 * so the current answer benefits from the summary just written. That ordering
 * is right, and it is also what made the call dangerous: on the default budget
 * (`AI_REQUEST_TIMEOUT_MS`, 120 s) a hung summariser could burn 120 s on the
 * primary vendor and 120 s more on the fallback — four minutes — before the
 * question was sent at all. The user experiences that as the assistant hanging,
 * and it gets worse the longer the conversation, which is the opposite of what
 * memory is supposed to feel like.
 *
 * The summary is optional to the turn: `condense` swallows its own failures and
 * `summary_through` only advances on success, so a skipped batch simply retries
 * next turn. Optional work does not get to spend the critical path's budget.
 *
 * These tests assert the WIRING (a bounded, single-vendor call) rather than
 * mocking a slow socket — the wiring is the thing that regresses, and a real
 * timing test would be slow and flaky for no extra signal.
 */
"use strict";

const { config } = require("../../src/config/env");

describe("AI_SUMMARY_TIMEOUT_MS", () => {
  it("is far tighter than the critical-path budget", () => {
    expect(config.AI_SUMMARY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(config.AI_SUMMARY_TIMEOUT_MS).toBeLessThan(config.AI_REQUEST_TIMEOUT_MS);
    // A summary that has not answered in half a minute is not going to make
    // this turn better. Pinned as an order-of-magnitude bound, not an exact
    // value, so the number stays tunable without the test becoming noise.
    expect(config.AI_SUMMARY_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

/* The vendor config is read from the PLATFORM database, not the tenant client,
 * so it is mocked the same way `ai-llm-body.test.js` does it. Returning a
 * usable row for every vendor name is what lets the fallback hop be observed. */
jest.mock("axios");
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn(async (vendor) => ({
    vendor,
    api_key: "test-key",
    endpoint_url: "https://vendor.example/v1",
    model: "test-model",
    is_active: true,
  })),
}));

const axios = require("axios");
const llm = require("../../src/services/ai/llm.service");

describe("llm.chat honours a caller-supplied budget and vendor chain", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes timeoutMs through to the vendor call", async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: "ok" } }] } });
    await llm.chat({ client: {}, messages: [], timeoutMs: 20_000 });
    expect(axios.post.mock.calls[0][2].timeout).toBe(20_000);
  });

  it("falls back to the default budget when no timeout is named", async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: "ok" } }] } });
    await llm.chat({ client: {}, messages: [] });
    expect(axios.post.mock.calls[0][2].timeout).toBe(config.AI_REQUEST_TIMEOUT_MS);
  });

  it("singleVendor makes ONE attempt — no fallback hop to double the wait", async () => {
    // THE REGRESSION GUARD. Two vendors × 120 s was the four-minute stall in
    // front of the user's question.
    const err = new Error("timeout of 20000ms exceeded");
    err.code = "ECONNABORTED";
    axios.post.mockRejectedValue(err);
    const res = await llm.chat({ client: {}, messages: [], singleVendor: true, timeoutMs: 20_000 });
    expect(axios.post).toHaveBeenCalledTimes(1);
    // The chain is exhausted, so the stub answers — which for the summariser
    // means `res.text` is the stub and `condense` returns without advancing
    // `summary_through`. Nothing is lost; the batch retries next turn.
    expect(res).toBeDefined();
  });

  it("a normal call still tries the fallback vendor", async () => {
    // The tighter contract is opt-in. Answer-path calls must keep their
    // resilience — this is the guard against someone applying singleVendor
    // broadly because it looked tidier.
    const err = new Error("boom");
    err.response = { status: 503 };
    axios.post.mockRejectedValue(err);
    await llm.chat({ client: {}, messages: [] });
    expect(axios.post.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("the summariser is wired to the bounded contract", () => {
  /**
   * Asserted by reading the call site rather than by driving `condense`.
   *
   * `condense` is internal to the orchestrator and its real path pulls in the
   * governance gate, the conversation repo and the usage ledger. Faking all
   * three to observe one argument would test the fakes; what must not regress
   * is that THIS call site names the summary budget and drops the fallback, and
   * that is exactly what is checked.
   */
  it("condense names the summary budget and disables the fallback", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/services/ai/orchestrator.service.js"),
      "utf8",
    );
    const start = src.indexOf("async condense(");
    expect(start).toBeGreaterThan(-1);
    const condense = src.slice(start, src.indexOf("// Actions the AI may propose"));
    expect(condense).toContain("timeoutMs: config.AI_SUMMARY_TIMEOUT_MS");
    expect(condense).toContain("singleVendor: true");
  });

  it("condense still swallows its own failures — memory never costs an answer", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/services/ai/orchestrator.service.js"),
      "utf8",
    );
    const start = src.indexOf("async condense(");
    const condense = src.slice(start, src.indexOf("// Actions the AI may propose"));
    // A budget that turned a slow summary into a FAILED TURN would be a worse
    // bug than the stall it replaced.
    expect(condense).toContain("catch");
    expect(condense).toContain("conversation summarisation skipped");
  });
});
