"use strict";
/**
 * Audit remediation PR 1 — grounding integrity (A1, A3, A4).
 *
 * ── WHAT BROKE, AND WHY IT NEEDED A TEST ────────────────────────────────────
 *
 * One `redact()` guarded every egress path, and its catch-all
 * `\b\d{9,}\b → [NUM]` meant the model never saw a number of nine digits or
 * more. In XAF that is every amount from a hundred million up — an ordinary
 * receivable for a forwarder. Asked "what is our largest receivable", the model
 * was handed `[NUM]` and either refused or invented a figure. Nothing failed:
 * the redaction worked exactly as written, the answer came back fluent, and the
 * only symptom was that it was wrong.
 *
 * That is the shape of bug a test has to pin, because no gate catches it and no
 * user can tell by reading the answer. So the cases below assert on the exact
 * figure and the exact reference, in both directions:
 *
 *   REASONING  the caller's own authorised data, prompt-only. Amounts, ERP
 *              refs, contact details and the tax ID arrive INTACT.
 *   EXTERNAL   persisted, indexed, or client-facing (summariser, embeddings,
 *              proposal generator). Contact data and the tax ID are masked —
 *              but amounts and refs survive there too, because the rolling
 *              summary's FIGURES heading asks for them "copied EXACTLY" and
 *              `[NUM]` made that impossible.
 *
 * Both paths still mask payment instruments and individual government identity
 * numbers. That is the part of the policy that did NOT loosen, and the cases
 * that prove it are as load-bearing as the ones that prove the loosening.
 */

const { logger } = require("../../src/config/logger");

jest.mock("axios", () => ({ post: jest.fn() }));
jest.mock("../../src/services/ai/llm.service", () => ({ chat: jest.fn() }));
jest.mock("../../src/services/platform/db", () => ({ query: jest.fn() }));
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn() }));
jest.mock("../../src/services/ai/embeddings.service", () => ({
  embedOne: jest.fn(async () => [0.1, 0.2, 0.3]),
  embedBatch: jest.fn(async () => []),
}));

const axios = require("axios");
const platformDb = require("../../src/services/platform/db");
const platformVendors = require("../../src/services/platform/ai-vendor.service");
const llm = require("../../src/services/ai/llm.service");
const orchestrator = require("../../src/services/ai/orchestrator.service");
const { retrieve, compose } = require("../../src/services/ai/retrieval.service");
const {
  redact,
  redactExternal,
  redactForReasoning,
} = require("../../src/services/ai/redact");

// An everyday figure here, and the exact one the old rule blacked out: nine
// digits, one hundred and twenty-five million XAF.
const RECEIVABLE = "125000000";
const ERP_REF = "AB1234567";

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// A1 — the reasoning path
// ─────────────────────────────────────────────────────────────────────────────

describe("redactForReasoning — the figures and refs the ERP exists to report (A1)", () => {
  test("a nine-figure amount reaches the model as itself, not [NUM]", () => {
    const out = redactForReasoning(`Largest receivable: ${RECEIVABLE} XAF`);
    expect(out).toContain(RECEIVABLE);
    expect(out).not.toContain("[NUM]");
  });

  test("a thousand-grouped amount survives in every common format", () => {
    for (const amount of ["1 250 000 000", "1,250,000,000", "1.250.000.000", "999999999"]) {
      const out = redactForReasoning(`Total ${amount} XAF`);
      expect(out).toContain(amount);
    }
  });

  test("an ERP reference is not mistaken for a passport", () => {
    // `AB1234567` matches the old unanchored passport shape exactly. Every
    // dossier, customs and consignment ref of that form was being blacked out.
    const out = redactForReasoning(`Customs ref ${ERP_REF} cleared on dossier DOS-0012.`);
    expect(out).toBe(`Customs ref ${ERP_REF} cleared on dossier DOS-0012.`);
  });

  test("contact data reaches the model — answering 'who do I email' is the job", () => {
    const out = redactForReasoning("Contact marie@sodecoton.cm on +237 699 123 456.");
    expect(out).toContain("marie@sodecoton.cm");
    expect(out).toContain("699 123 456");
  });

  test("the tax ID survives — an invoice has to carry it", () => {
    expect(redactForReasoning("NIU P001234567890A")).toContain("P001234567890A");
  });

  // ── and what did NOT loosen ──

  test("payment instruments stay masked, because reasoning never needs the digits", () => {
    expect(redactForReasoning("Supplier bank CM21 10003 00001 00200456789 41")).toContain("[IBAN]");
    expect(redactForReasoning("Card 4111 1111 1111 1111")).toContain("[CARD]");
    expect(redactForReasoning("Card 4111-1111-1111-1111")).toContain("[CARD]");
  });

  test("individual government identity numbers stay masked", () => {
    expect(redactForReasoning("CNPS-123456789")).toContain("[SSN]");
    expect(redactForReasoning("Passport no. AB1234567 for the driver")).toContain("[PASSPORT]");
    expect(redactForReasoning("AB1234567 is his passport")).toContain("[PASSPORT]");
  });

  test("an account-LABELLED digit run is still masked; an unlabelled figure is not", () => {
    // The distinction is structural: what surrounds the run, not how long it is.
    expect(redactForReasoning("Account number: 123456789012")).toContain("[NUM]");
    expect(redactForReasoning("GL account 401100 balance 250000000")).toContain("250000000");
  });

  test("a run too long to be any plausible figure is still masked", () => {
    expect(redactForReasoning("Ref 1234567890123456")).toContain("[NUM]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A1 — the external path (the half that must NOT loosen)
// ─────────────────────────────────────────────────────────────────────────────

describe("redactExternal — strict, and still what a careless caller gets (A1/F3)", () => {
  test("`redact` is the strict one, so an unqualified import is the safe import", () => {
    expect(redact).toBe(redactExternal);
  });

  test("contact data and the tax ID are masked", () => {
    const out = redactExternal("Contact marie@sodecoton.cm on +237 699 123 456, NIU P001234567890A.");
    expect(out).toContain("[EMAIL]");
    expect(out).toContain("[PHONE]");
    expect(out).toContain("[NIU]");
    expect(out).not.toContain("sodecoton.cm");
  });

  test("everything the reasoning path masks, this path masks too", () => {
    for (const [text, token] of [
      ["Supplier bank CM21 10003 00001 00200456789 41", "[IBAN]"],
      ["Card 4111 1111 1111 1111", "[CARD]"],
      ["CNPS: CNPS-123456789", "[SSN]"],
      ["Passport no. AB1234567", "[PASSPORT]"],
      ["Account number: 123456789012", "[NUM]"],
    ]) {
      expect(redactExternal(text)).toContain(token);
    }
  });

  test("amounts and refs survive HERE too — the summary's FIGURES heading needs them (D3)", () => {
    // The summariser is told to copy figures EXACTLY and never round. It was
    // being handed `[NUM]` and asked to do that.
    const out = redactExternal(`FIGURES: receivable ${RECEIVABLE} XAF on ${ERP_REF}`);
    expect(out).toContain(RECEIVABLE);
    expect(out).toContain(ERP_REF);
  });

  test("a nine-figure amount is not mistaken for a Cameroon mobile", () => {
    // `600 000 000` and `699 123 456` are the same shape. The currency token is
    // what tells them apart, and without the guard the summariser would have
    // turned six hundred million XAF into [PHONE].
    expect(redactExternal("Balance 600 000 000 XAF")).toContain("600 000 000");
    expect(redactExternal("XAF 600 000 000")).toContain("600 000 000");
    expect(redactExternal("Mobile: 699123456")).toContain("[PHONE]");
    expect(redactExternal("Call +237 699 123 456")).toContain("[PHONE]");
  });

  test("the two paths differ on contact data and the tax ID, and nowhere else", () => {
    const shared = [
      "Supplier bank CM21 10003 00001 00200456789 41",
      "Card 4111 1111 1111 1111",
      "CNPS-123456789",
      "Passport no. AB1234567",
      "Account number: 123456789012",
      `Receivable ${RECEIVABLE} XAF on ${ERP_REF}`,
      "Invoice SBX-2026-0001 for SODECOTON, total 500,000 XAF.",
    ];
    for (const text of shared) {
      expect(redactForReasoning(text)).toBe(redactExternal(text));
    }
  });

  test("empty and nullish input are still the empty string on both paths", () => {
    for (const fn of [redactForReasoning, redactExternal]) {
      expect(fn("")).toBe("");
      expect(fn(null)).toBe("");
      expect(fn(undefined)).toBe("");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A1 — the wiring, end to end. The acceptance criterion.
// ─────────────────────────────────────────────────────────────────────────────

describe("ask() — the figure reaches the model (A1 acceptance)", () => {
  const user = { user_id: "11111111-1111-1111-1111-111111111111", is_ceo: true };

  function fakeClient() {
    return {
      query: jest.fn(async (sql) => {
        if (/FROM feature_state/.test(sql)) return { rows: [{ state: "on" }] };
        if (/FROM ai_action_catalogue/.test(sql)) {
          return {
            rows: [{
              action_key: "list_final_invoices",
              title: "list final invoices",
              description: null,
              payload_schema: {},
              is_write: false,
              required_permission: null,
              requires_confirmation: false,
            }],
          };
        }
        return { rows: [] };
      }),
    };
  }

  /** Every message body sent to the model across every call in the turn. */
  const everythingSent = () =>
    llm.chat.mock.calls
      .flatMap(([arg]) => arg.messages || [])
      .map((m) => String(m.content || ""))
      .join("\n");

  it("reports the exact receivable and the exact ref, not [NUM] and [PASSPORT]", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });

    llm.chat
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "call-1", function: { name: "list_final_invoices", arguments: "{}" } }],
        provider: "test",
        usage: {},
      })
      .mockResolvedValueOnce({
        text: `The largest receivable is ${RECEIVABLE} XAF.`,
        toolCalls: [],
        provider: "test",
        usage: {},
      });

    const res = await orchestrator.ask({
      client: fakeClient(),
      user,
      message: "what is our largest receivable?",
      registry: {
        list_final_invoices: async () => ({
          data: [{
            doc_number: "SBX-INV-0031",
            customs_ref: ERP_REF,
            outstanding_xaf: Number(RECEIVABLE),
            contact_email: "marie@sodecoton.cm",
          }],
        }),
      },
    });

    const sent = everythingSent();
    // The tool result the model reasons over carries the real figure…
    expect(sent).toContain(RECEIVABLE);
    expect(sent).toContain(ERP_REF);
    expect(sent).toContain("marie@sodecoton.cm");
    // …and none of the placeholders that used to stand in for them.
    expect(sent).not.toContain("[NUM]");
    expect(sent).not.toContain("[PASSPORT]");
    expect(sent).not.toContain("[EMAIL]");
    expect(res.answer).toContain(RECEIVABLE);
  });

  it("still masks a supplier's bank details on the way into the prompt", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });

    llm.chat
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "call-1", function: { name: "list_final_invoices", arguments: "{}" } }],
        provider: "test",
        usage: {},
      })
      .mockResolvedValueOnce({ text: "Done.", toolCalls: [], provider: "test", usage: {} });

    await orchestrator.ask({
      client: fakeClient(),
      user,
      message: "list the invoices",
      registry: {
        list_final_invoices: async () => ({
          data: [{ doc_number: "SBX-INV-0031", iban: "CM21 10003 00001 00200456789 41" }],
        }),
      },
    });

    const sent = everythingSent();
    expect(sent).toContain("[IBAN]");
    expect(sent).not.toContain("00200456789");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A1 — embeddings egress
// ─────────────────────────────────────────────────────────────────────────────

describe("embeddings — one strict choke point, both sides of it (A1)", () => {
  // The real module; its own `axios` and vendor lookup are still the mocks above.
  const embeddings = jest.requireActual("../../src/services/ai/embeddings.service");

  it("masks PII before the text reaches the vendor, and keeps the figures", async () => {
    platformVendors.getConfig.mockResolvedValue({
      api_key: "k", endpoint_url: "https://vendor.test/v1", model: "m", is_active: true,
    });
    axios.post.mockResolvedValue({ data: { data: [{ embedding: [0.1] }] } });

    await embeddings.embedBatch(null, [
      `Invoice ${ERP_REF}: ${RECEIVABLE} XAF, contact marie@sodecoton.cm`,
    ]);

    const [, body] = axios.post.mock.calls[0];
    expect(body.input[0]).toContain("[EMAIL]");
    expect(body.input[0]).not.toContain("sodecoton.cm");
    // Corpus and query are masked by the SAME function, so a question about a
    // figure still matches the chunk that holds it. Masking one side only would
    // have bought nothing and cost recall.
    expect(body.input[0]).toContain(RECEIVABLE);
    expect(body.input[0]).toContain(ERP_REF);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A3 / A4 — retrieval breadth, separate budgets, no codebase in tenant answers
// ─────────────────────────────────────────────────────────────────────────────

describe("compose — three pools, three budgets (A3)", () => {
  const hit = (pool, sim, ref) => ({ pool, sim, ref: ref || `${pool}:${sim}` });

  it("reserves the knowledge budget even when tenant hits outrank it", () => {
    // The failure this prevents: a thousand entity cards at sim 0.9 and the
    // OHADA KB at 0.4, so the one document that knows SYSCOHADA never appears.
    const ranked = [
      ...Array.from({ length: 20 }, (_, i) => hit("tenant", 0.9 - i / 100)),
      hit("knowledge", 0.4, "doc/OHADA_KB.md"),
      hit("knowledge", 0.35, "doc/PRD.md"),
    ];
    const out = compose(ranked, { k: 12, kbBudget: 4, codeBudget: 0 });
    expect(out).toHaveLength(12);
    expect(out.filter((h) => h.pool === "knowledge")).toHaveLength(2);
    expect(out.filter((h) => h.pool === "tenant")).toHaveLength(10);
  });

  it("gives an unused knowledge slot back to the tenant rather than wasting it", () => {
    const ranked = Array.from({ length: 20 }, (_, i) => hit("tenant", 0.9 - i / 100));
    const out = compose(ranked, { k: 12, kbBudget: 4, codeBudget: 0 });
    expect(out).toHaveLength(12);
    expect(out.every((h) => h.pool === "tenant")).toBe(true);
  });

  it("caps codebase chunks hard — the budget is a ceiling, not a reservation", () => {
    const ranked = [
      ...Array.from({ length: 20 }, (_, i) => hit("codebase", 0.99 - i / 100)),
      ...Array.from({ length: 20 }, (_, i) => hit("tenant", 0.5 - i / 100)),
    ];
    const out = compose(ranked, { k: 12, kbBudget: 4, codeBudget: 2 });
    expect(out.filter((h) => h.pool === "codebase")).toHaveLength(2);
  });

  it("returns hits in similarity order, so the context block reads best-first", () => {
    const out = compose(
      [hit("tenant", 0.3), hit("knowledge", 0.8), hit("tenant", 0.5)],
      { k: 12, kbBudget: 4, codeBudget: 0 },
    );
    expect(out.map((h) => h.sim)).toEqual([0.8, 0.5, 0.3]);
  });
});

describe("retrieve — a tenant answer is not grounded on our source code (A4)", () => {
  const row = (kind, ref, sim) => ({ kind, ref, title: ref, content: "c", sim });

  it("queries only the knowledge kinds, and never the codebase, by default", async () => {
    platformDb.query.mockResolvedValue({ rows: [row("doc", "doc/OHADA_KB.md", 0.7)] });

    await retrieve({ query: "how do I post VAT?", k: 12 });

    expect(platformDb.query).toHaveBeenCalledTimes(1);
    const [sql, params] = platformDb.query.mock.calls[0];
    expect(sql).toContain("d.kind = ANY($3)");
    expect(sql).not.toContain("NOT (d.kind = ANY($3))");
    expect(params[2]).toEqual(["doc", "other"]);
  });

  it("over-fetches per corpus so the floor and the budgets have room to choose", async () => {
    // The old code used `k` as both the per-corpus LIMIT and the final slice, so
    // six was the whole answer AND the whole candidate set.
    platformDb.query.mockResolvedValue({ rows: [] });
    await retrieve({ query: "receivables", k: 12 });
    expect(platformDb.query.mock.calls[0][1][1]).toBeGreaterThan(12);
  });

  it("adds the codebase query only for a caller that asked for it", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    await retrieve({ query: "how does Praxis work?", k: 12, includeCodebase: true });

    expect(platformDb.query).toHaveBeenCalledTimes(2);
    expect(platformDb.query.mock.calls[1][0]).toContain("NOT (d.kind = ANY($3))");
  });

  it("drops hits below the similarity floor instead of padding with noise", async () => {
    platformDb.query.mockResolvedValue({
      rows: [row("doc", "doc/OHADA_KB.md", 0.7), row("doc", "doc/unrelated.md", 0.01)],
    });
    const out = await retrieve({ query: "receivables", k: 12 });
    expect(out.map((h) => h.ref)).toEqual(["doc/OHADA_KB.md"]);
  });

  it("grounds nothing rather than crashing when embeddings are unconfigured", async () => {
    const embeddings = require("../../src/services/ai/embeddings.service");
    embeddings.embedOne.mockResolvedValueOnce(undefined);
    expect(await retrieve({ query: "anything" })).toEqual([]);
    expect(platformDb.query).not.toHaveBeenCalled();
  });
});
