"use strict";
/**
 * AI health telemetry (13940, audit H2).
 *
 * The audit's complaint is that truncation, tool-selection misses,
 * duplicate-read grooves and fallback-to-stub are DETECTED and then discarded.
 * So these assert the two halves that make a counter real:
 *
 *   1. the signal reaches the recorder at all — `finish_reason` was never read
 *      before this, which is why B1's `max_tokens` fix has been unverifiable in
 *      production ever since it shipped;
 *   2. the recorder cannot silently no-op — a typo'd kind, a swallowed error or
 *      a summary that omits the zero rows all produce a metric that reads clean
 *      while measuring nothing, which is the exact failure H2 is about.
 */

jest.mock("axios");
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn(async (name) => ({
    vendor: name,
    api_key: "test-key",
    endpoint_url: `https://${name}.example/v1`,
    model: `${name}-model`,
    is_active: true,
  })),
}));

const axios = require("axios");
const llm = require("../../src/services/ai/llm.service");
const health = require("../../src/services/ai/health.service");

const fakeClient = (impl) => ({ query: jest.fn(impl || (async () => ({ rows: [], rowCount: 0 }))) });

async function* sse(chunks) {
  for (const c of chunks) yield Buffer.from(c);
}

const drain = async (gen) => {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
};

const kindsOf = (events) => (events || []).map((e) => e.kind);

beforeEach(() => jest.clearAllMocks());

describe("health.record — the recorder cannot silently no-op", () => {
  it("writes the row and stringifies the detail, which is jsonb", async () => {
    const c = fakeClient();
    await expect(
      health.record(c, { kind: health.KINDS.TRUNCATION, userId: "u1", detail: { max_tokens: 4096 } }),
    ).resolves.toBe(true);
    const [sql, params] = c.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO ai_health_event");
    expect(params[3]).toBe("truncation");
    expect(params[6]).toBe('{"max_tokens":4096}');
  });

  it("REFUSES an unknown kind rather than writing it", async () => {
    // A typo'd kind is a counter that reads zero for ever and is believed.
    const c = fakeClient();
    await expect(health.record(c, { kind: "trunkation" })).resolves.toBe(false);
    expect(c.query).not.toHaveBeenCalled();
  });

  it("never throws when the insert fails — observability must not fail a turn", async () => {
    const c = fakeClient(async () => {
      throw new Error("relation \"ai_health_event\" does not exist");
    });
    await expect(health.record(c, { kind: health.KINDS.GROOVE })).resolves.toBe(false);
  });

  it("records a batch and reports how many landed", async () => {
    const c = fakeClient();
    const n = await health.recordAll(
      c,
      [{ kind: health.KINDS.FALLBACK }, { kind: health.KINDS.TIMEOUT }],
      { userId: "u1", conversationId: "c1" },
    );
    expect(n).toBe(2);
    // The per-turn context is merged in, so the caller states it once.
    expect(c.query.mock.calls[0][1][0]).toBe("u1");
    expect(c.query.mock.calls[1][1][1]).toBe("c1");
  });

  it("treats an empty or absent batch as nothing to do", async () => {
    const c = fakeClient();
    expect(await health.recordAll(c, undefined)).toBe(0);
    expect(await health.recordAll(c, [])).toBe(0);
    expect(c.query).not.toHaveBeenCalled();
  });
});

describe("health.summary — rates, and every kind", () => {
  const withRows = (turns, rows) =>
    fakeClient(async (sql) =>
      sql.includes("ai_usage_ledger") ? { rows: [{ turns }] } : { rows },
    );

  it("returns EVERY kind, including the ones at zero", async () => {
    // A panel that lists only what fired cannot show a rate trending to zero —
    // the row disappears at the moment it becomes good news.
    const { kinds } = await health.summary(withRows(1000, []), { days: 7 });
    expect(kinds.map((k) => k.kind).sort()).toEqual(Object.values(health.KINDS).sort());
    expect(kinds.every((k) => k.events === 0)).toBe(true);
  });

  it("reports a rate per 1k turns, not a raw count", async () => {
    // 12 truncations is excellent on 10,000 turns and alarming on 20.
    const { kinds, turns } = await health.summary(
      withRows(10000, [{ kind: "truncation", events: 12, last_at: "2026-09-19T00:00:00Z" }]),
      { days: 7 },
    );
    expect(turns).toBe(10000);
    const trunc = kinds.find((k) => k.kind === "truncation");
    expect(trunc.events).toBe(12);
    expect(trunc.per_1k).toBe(1.2);
  });

  it("reports a null rate rather than a fake zero when there were no turns", async () => {
    const { kinds } = await health.summary(withRows(0, []), { days: 7 });
    expect(kinds.every((k) => k.per_1k === null)).toBe(true);
  });

  it("clamps the window so a caller cannot ask for an unbounded scan", async () => {
    const c = withRows(1, []);
    expect((await health.summary(c, { days: 5000 })).window_days).toBe(90);
    expect((await health.summary(c, { days: 0 })).window_days).toBe(7);
  });
});

describe("llm.chat surfaces what only it can see", () => {
  const reply = (content, finish) => ({
    data: { choices: [{ message: { content }, finish_reason: finish }], usage: {} },
  });

  it("reports a truncated answer — finish_reason was never read before H2", async () => {
    axios.post.mockResolvedValue(reply("cut off mid-", "length"));
    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    expect(res.finishReason).toBe("length");
    expect(kindsOf(res.health)).toContain(health.KINDS.TRUNCATION);
  });

  it("says nothing when the answer completed normally", async () => {
    axios.post.mockResolvedValue(reply("all done", "stop"));
    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    expect(res.health).toEqual([]);
  });

  it("reports a fallback — the turn succeeded, on a different vendor", async () => {
    const boom = Object.assign(new Error("503"), { response: { status: 503 } });
    axios.post.mockRejectedValueOnce(boom).mockResolvedValueOnce(reply("ok", "stop"));
    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    // Nothing in the answer, the usage row or the status code says this
    // happened; the cost model and the answer are the fallback's (audit B2).
    expect(kindsOf(res.health)).toContain(health.KINDS.FALLBACK);
  });

  it("separates a dead credential from a transient failure", async () => {
    const unauth = Object.assign(new Error("401"), { response: { status: 401 } });
    axios.post.mockRejectedValueOnce(unauth).mockResolvedValueOnce(reply("ok", "stop"));
    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    expect(kindsOf(res.health)).toContain(health.KINDS.VENDOR_CONFIG_ERROR);
    expect(kindsOf(res.health)).toContain(health.KINDS.FALLBACK);
  });

  it("counts a timeout as its own signal, not just a transient error", async () => {
    // A 5xx is the vendor's problem; a timeout usually means OUR cap is too
    // tight for a real multi-hop turn (audit E1). Same routing, different fix.
    const slow = Object.assign(new Error("timeout of 120000ms exceeded"), { code: "ECONNABORTED" });
    axios.post.mockRejectedValue(slow);
    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    expect(kindsOf(res.health)).toContain(health.KINDS.TIMEOUT);
  });

  it("reports the stub as provider_exhausted — the audit's fallback-to-stub", async () => {
    axios.post.mockRejectedValue(Object.assign(new Error("500"), { response: { status: 500 } }));
    const res = await llm.chat({ client: {}, messages: [{ role: "user", content: "hi" }] });
    expect(kindsOf(res.health)).toContain(health.KINDS.PROVIDER_EXHAUSTED);
    expect(res.provider).toBeNull();
  });
});

describe("llm.chatStream carries the same signals on the terminal chunk", () => {
  it("reports truncation from a finish_reason frame", async () => {
    axios.post.mockResolvedValue({
      data: sse([
        'data: {"choices":[{"delta":{"content":"cut"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    });
    const chunks = await drain(llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }] }));
    const done = chunks.find((c) => c.done);
    // The reason arrives on its own frame BEFORE [DONE], whose frame has no
    // choices — reading it at the terminal frame would always see null.
    expect(done.finishReason).toBe("length");
    expect(kindsOf(done.health)).toContain(health.KINDS.TRUNCATION);
  });

  it("treats a stream that dies without [DONE] as a truncation", async () => {
    axios.post.mockResolvedValue({ data: sse(['data: {"choices":[{"delta":{"content":"half"}}]}\n\n']) });
    const chunks = await drain(llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }] }));
    const done = chunks.find((c) => c.done);
    // The connection stopped mid-answer. That IS a cut-off answer, and
    // reporting "we do not know" would lose the one case a user actually sees.
    expect(kindsOf(done.health)).toContain(health.KINDS.TRUNCATION);
  });

  it("stays silent on a clean stream", async () => {
    axios.post.mockResolvedValue({
      data: sse([
        'data: {"choices":[{"delta":{"content":"all good"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    });
    const chunks = await drain(llm.chatStream({ client: {}, messages: [{ role: "user", content: "hi" }] }));
    expect(chunks.find((c) => c.done).health).toEqual([]);
  });
});
