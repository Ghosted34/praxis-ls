/**
 * THE AI ENGINE, AT ITS CALL SITES (§8.11, §8.12).
 *
 * The chapter this file guards shipped with `assist.factfence`,
 * `assist.glossary`, `assist.guardrails`, `assist.prompts` and
 * `assist.grounding` all correct and all individually unit-tested — and no
 * engine between them. `compose()` returned a prompt string; `draft()` returned
 * the `facts` array it was handed, which the route never passed. Every one of
 * those leaf tests passed the whole time.
 *
 * So nothing here tests a leaf. Every test below asserts that the PRODUCT calls
 * one:
 *
 *   · that a model is actually invoked,
 *   · that the whitelist actually reads,
 *   · that the fence actually sees the generated text,
 *   · that the ledger actually gets a row,
 *   · and that the gate is the shared one, not a local re-implementation.
 *
 * A test that imports `assist.factfence` and calls `fence()` has tested the
 * fence. It has not tested that a draft goes through it.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  chat: jest.fn(async () => ({ provider: "deepseek", text: "Bonjour.", toolCalls: [], usage: {} })),
  PRIMARY: "deepseek", FALLBACK: "gemini",
}));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ allowed: true, budget_state: "OK" })),
  recordUsage: jest.fn(async () => ({})),
}));
jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(async () => [{ can_read: true }]),
  getUserScopeClosure: jest.fn(async () => []),
}));
jest.mock("../../src/modules/operations/operations_file/operations_file.service", () => ({
  get: jest.fn(async () => ({ ref: "SLAS-2026-0042", status: "IN_TRANSIT", incoterm: "FOB", eta: "2026-09-01" })),
}));
jest.mock("../../src/modules/operations/milestone/milestone.service", () => ({
  listByDossier: jest.fn(async () => []),
}));
jest.mock("../../src/modules/finance/final_invoice/final_invoice.service", () => ({
  list: jest.fn(async () => [{ doc_number: "INV-2026-0311", total_ttc: 4500000, currency: "XAF", status: "ISSUED", payment_due_on: "2026-09-15" }]),
}));
jest.mock("../../src/modules/finance/smart_receivables/smart_receivables.service", () => ({
  ageing: jest.fn(async () => ({ open_count: 0 })),
}));
jest.mock("../../src/modules/commercial/quotation/quotation.service", () => ({
  list: jest.fn(async () => []),
}));
jest.mock("../../src/modules/master/client_master/client_master.service", () => ({
  get: jest.fn(async () => ({ name: "Camrail SARL", payment_terms_days: 30 })),
}));
jest.mock("../../src/modules/mail/binding/intake.service", () => ({
  chaseList: jest.fn(async () => ({ nothing_outstanding: true, missing: [] })),
}));

const fs = require("fs");
const path = require("path");
const llm = require("../../src/services/ai/llm.service");
const governance = require("../../src/modules/ai/governance/governance.service");
const identityCache = require("../../src/shared/cache/identity-cache");
const opsFile = require("../../src/modules/operations/operations_file/operations_file.service");
const finalInvoice = require("../../src/modules/finance/final_invoice/final_invoice.service");
const { emitEvent } = require("../../src/shared/events/emit");
const assist = require("../../src/modules/mail/assist/assist.service");
const grounding = require("../../src/modules/mail/assist/assist.grounding");

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
const THREAD = (over = {}) => ({
  match: /FROM email_thread t/,
  rows: [{
    email_thread_id: "t-1", subject: "Quote for 2x40HC", entity_ref: "dossier:d-1",
    client_id: null, dossier_client_id: "c-1", dossier_id: "d-1", supplier_id: null,
    client_language: "fr", ...over,
  }],
});
const MESSAGES = {
  match: /FROM email_message\s+WHERE email_thread_id/,
  rows: [{ email_message_id: "m-1", direction: "IN", from_address: "t@camrail.cm", body_text: "Where is my container?" }],
};

const ME = { user_id: "u-me", role_ids: ["r-1"] };
const base = (over = []) => [ON, THREAD(), MESSAGES, ...over];

beforeEach(() => {
  jest.clearAllMocks();
  llm.chat.mockResolvedValue({ provider: "deepseek", text: "Bonjour.", toolCalls: [], usage: {} });
  governance.canUseFeature.mockResolvedValue({ allowed: true, budget_state: "OK" });
  identityCache.getGrants.mockResolvedValue([{ can_read: true }]);
});

/* ── 1. A model is called at all ──────────────────────────────────────────── */

describe("the assistant calls a model", () => {
  test("draft() reaches llm.service.chat", async () => {
    await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    // The single assertion the old implementation could never have passed.
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  test("compose() reaches llm.service.chat and returns generated text, not the prompt", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "Dear Thierry,", usage: {} });
    const out = await assist.compose(fakeClient(base()), { tone: "formal", thread_id: "t-1" }, ME);
    expect(llm.chat).toHaveBeenCalled();
    expect(out.draft_text).toBe("Dear Thierry,");
    // `prompt` survives as a label for the UI. It is no longer the ANSWER,
    // which is what it used to be.
    expect(out.prompt).not.toBe(out.draft_text);
  });

  test.each(["rewrite", "translate", "voice"])("%s() reaches the model too", async (fn) => {
    const args = {
      rewrite: { text: "hello", action: "shorten" },
      translate: { text: "hello", to: "fr" },
      voice: { transcript: "tell them the container arrived" },
    }[fn];
    await assist[fn](fakeClient(base()), args, ME);
    expect(llm.chat).toHaveBeenCalled();
  });

  test("the model is told, in the prompt, not to invent", async () => {
    await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    const system = llm.chat.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/Do NOT state any reference number, amount, date or percentage/);
    // The prompt is the first line of defence and the fence is the second.
    // Asserting both because a system with only the prompt ships fabricated
    // invoice numbers on the tail of the distribution.
  });
});

/* ── 2. The whitelist executes ────────────────────────────────────────────── */

describe("the grounding whitelist actually reads", () => {
  test("a dossier-bound thread reads the operations file THROUGH the module service", async () => {
    await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    // §8.4: "`read` MUST call the module's SERVICE, never SQL, so RBAC and
    // field visibility apply exactly as they do in the UI."
    expect(opsFile.get).toHaveBeenCalledWith(expect.anything(), "d-1");
    expect(finalInvoice.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ client_id: "c-1" }));
  });

  test("the facts reach the model's system message", async () => {
    await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    const system = llm.chat.mock.calls[0][0].messages[0].content;
    expect(system).toMatch(/SLAS-2026-0042/);
    expect(system).toMatch(/INV-2026-0311/);
  });

  test("the facts come back to the caller, named by source", async () => {
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    // The composer's sources strip. Without it the operator has a draft and no
    // way to check it against the record, which is trust rather than review.
    expect(out.sources.map((s) => s.key)).toEqual(
      expect.arrayContaining(["dossier_status", "invoice_status", "client_terms"]),
    );
    expect(out.facts.every((f) => f.source && f.text)).toBe(true);
  });

  test("a source the CALLER may not read is withheld, and said so", async () => {
    identityCache.getGrants.mockImplementation(async (_c, { module }) =>
      (module === "MOD-51" ? [] : [{ can_read: true }]));
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    // Mail's own MOD-72 grant says nothing about whether this user may read
    // invoices. Silently dropping it would make the draft quietly thinner for
    // some users than others with no way to tell why.
    expect(out.withheld.map((w) => w.key)).toContain("invoice_status");
    expect(out.sources.map((s) => s.key)).not.toContain("invoice_status");
    const system = llm.chat.mock.calls[0][0].messages[0].content;
    expect(system).not.toMatch(/INV-2026-0311/);
  });

  test("a caller with no identity at all gets nothing", async () => {
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, null);
    expect(out.facts).toEqual([]);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("a module that throws degrades the draft instead of killing it", async () => {
    opsFile.get.mockRejectedValue(new Error("dossier service down"));
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(out.withheld.map((w) => w.key)).toContain("dossier_status");
    expect(out.draft_text).toBeTruthy();
  });

  test("an unbound thread produces the honest note and spends nothing", async () => {
    const c = fakeClient([ON, THREAD({ entity_ref: null, dossier_id: null, dossier_client_id: null, client_id: null })]);
    const out = await assist.draft(c, { threadId: "t-1" }, ME);
    expect(out.note).toMatch(/not bound to a record/);
    expect(llm.chat).not.toHaveBeenCalled();
    // This was the ONLY branch the old implementation could reach. It is still
    // correct; it is now one of two.
  });

  test("bound-but-everything-withheld reads differently from unbound", async () => {
    identityCache.getGrants.mockResolvedValue([]);
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(out.note).toMatch(/every source was withheld/i);
    // Two different problems with two different fixes: bind the thread, versus
    // ask an administrator for a grant.
  });

  test("nothing on the deny list is reachable from the whitelist", () => {
    for (const s of grounding.SOURCES) expect(grounding.isDenied(s.key)).toBe(false);
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/assist/assist.grounding.js"), "utf8",
    );
    // A require is how a source gets added by accident. The deny list is a
    // list of names; this is a check on the imports.
    expect(src).not.toMatch(/require\(.*(costing|payroll|margin_simulation|pricing_variance)/);
  });
});

/* ── 3. The fence runs on real output ─────────────────────────────────────── */

describe("the fact-fence sees the generated text", () => {
  test("a fabricated reference is caught", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "Your invoice INV-2026-9999 is due.", usage: {} });
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(out.fence.ok).toBe(false);
    expect(out.fence.violations).toContain("INV-2026-9999");
    expect(out.needs_review).toBe(true);
  });

  test("a reference we GAVE it passes", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "Invoice INV-2026-0311 is with you.", usage: {} });
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(out.fence.ok).toBe(true);
    expect(out.needs_review).toBe(false);
  });

  test("a fenced draft is still RETURNED, with the violation marked", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "Due on 2026-12-25.", usage: {} });
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    // A blank composer teaches people to stop using the feature. A marked one
    // teaches them what the assistant does not know.
    expect(out.draft_text).toMatch(/2026-12-25/);
    expect(out.needs_review).toBe(true);
    expect(out.confidence).toBeLessThan(1);
  });

  test("protected terms the model dropped are put back", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "Nous confirmons la livraison.", usage: {} });
    const out = await assist.translate(fakeClient(base()), { text: "We confirm FOB Douala delivery.", to: "fr" }, ME);
    // §8.4: an LLM "improving" FOB Douala is the class of error that reaches a
    // customs broker and costs money.
    expect(out.draft_text).toMatch(/FOB/);
    expect(out.protected_terms_restored).toContain("FOB");
  });

  test("a rewrite is fenced against the operator's OWN text too", async () => {
    llm.chat.mockResolvedValue({ provider: "deepseek", text: "PO-2026-0007 confirmed.", usage: {} });
    const out = await assist.rewrite(fakeClient(base()),
      { text: "I confirm PO-2026-0007.", action: "shorten" }, ME);
    // They are entitled to state whatever they typed. Fencing them against the
    // ERP alone would flag every number they legitimately knew and we did not.
    expect(out.fence.ok).toBe(true);
  });
});

/* ── 4. Metering ──────────────────────────────────────────────────────────── */

describe("every call is metered to ai_usage_ledger", () => {
  test("a draft writes a usage row with feature mail_ai and a sub-type", async () => {
    await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(governance.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      featureKey: "mail_ai", callType: "draft.reply", userId: "u-me", wasSuccessful: true,
    }));
  });

  test.each([
    [["compose", { tone: "payment", thread_id: "t-1" }], "compose.payment"],
    [["rewrite", { text: "x", action: "expand" }], "rewrite.expand"],
    [["translate", { text: "x", to: "en" }], "translate.en"],
    [["voice", { transcript: "x" }], "voice.draft"],
  ])("%s is metered under its own sub-type", async ([fn, args], callType) => {
    await assist[fn](fakeClient(base()), args, ME);
    // One undifferentiated total does not let a finance lead see that the
    // month's mail spend was 80% translation and decide something about it.
    expect(governance.recordUsage).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ callType }),
    );
  });

  test("a FAILED call is metered too", async () => {
    llm.chat.mockRejectedValue(Object.assign(new Error("vendor 503"), { code: "VENDOR_DOWN" }));
    await expect(assist.draft(fakeClient(base()), { threadId: "t-1" }, ME)).rejects.toThrow(/vendor 503/);
    // A failed call still cost input tokens. Recording only successes is how a
    // budget silently under-reports.
    expect(governance.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      wasSuccessful: false, errorCode: "VENDOR_DOWN",
    }));
  });

  test("a metering failure does not cost the user their draft", async () => {
    governance.recordUsage.mockRejectedValue(new Error("ledger unavailable"));
    const out = await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(out.draft_text).toBeTruthy();
  });

  test("there is exactly ONE llm call site in the module", () => {
    const dir = path.resolve(__dirname, "../../src/modules/mail/assist");
    const hits = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .flatMap((f) => (fs.readFileSync(path.join(dir, f), "utf8").match(/llm\.chat\(/g) || []));
    // Metering decays by omission: a second call site that forgot recordUsage
    // would fail no test and raise no error. One site, one thing to get right.
    expect(hits).toHaveLength(1);
  });
});

/* ── 5. The gate ──────────────────────────────────────────────────────────── */

describe("the gate is the shared two-level one", () => {
  test("mail.ai off refuses before any model call", async () => {
    const c = fakeClient([{ match: /feature_state/, rows: [{ state: "off" }] }]);
    await expect(assist.draft(c, { threadId: "t-1" }, ME)).rejects.toMatchObject({ status: 403 });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("mail.ai ON but governance says no is still off", async () => {
    governance.canUseFeature.mockResolvedValue({ allowed: false, reason: "the plan's AI spend limit has been reached" });
    // §3.3: "an AI flag is a floor, not a ceiling."
    await expect(assist.draft(fakeClient(base()), { threadId: "t-1" }, ME))
      .rejects.toThrow(/plan's AI spend limit/);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("the refusal REASON is passed through verbatim", async () => {
    governance.canUseFeature.mockResolvedValue({ allowed: false, reason: "your access to this feature was revoked" });
    await expect(assist.compose(fakeClient(base()), { tone: "formal" }, ME))
      .rejects.toThrow(/access to this feature was revoked/);
    // "AI unavailable" sends the operator to nobody. These two sentences send
    // them to two different people.
  });

  test("it goes through governance.canUseFeature rather than re-reading feature_state", async () => {
    await assist.compose(fakeClient(base()), { tone: "formal" }, ME);
    expect(governance.canUseFeature).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      featureKey: "mail_ai", userId: "u-me",
    }));
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/assist/assist.service.js"), "utf8",
    );
    // The hand-rolled version read `ai.assistant.backend` here directly. It got
    // the two-level semantics right and skipped the budget entirely, so a
    // tenant past their hard cap kept drafting.
    expect(src).not.toMatch(/feature_key\s*=\s*'ai\.assistant\.backend'/);
  });

  test("every generating export gates first", async () => {
    const c = () => fakeClient([{ match: /feature_state/, rows: [{ state: "off" }] }]);
    const calls = {
      compose: [{ tone: "formal" }], draft: [{ threadId: "t-1" }],
      rewrite: [{ text: "x", action: "shorten" }], translate: [{ text: "x", to: "fr" }],
      summary: [{ threadId: "t-1" }], voice: [{ transcript: "x" }],
    };
    for (const [fn, args] of Object.entries(calls)) {
      await expect(assist[fn](c(), ...args)).rejects.toMatchObject({ status: 403 });
    }
  });
});

/* ── 6. It still writes nothing ───────────────────────────────────────────── */

describe("no AI path writes a business record", () => {
  test("a draft issues no INSERT or UPDATE outside mail's own tables", async () => {
    const c = fakeClient(base());
    await assist.draft(c, { threadId: "t-1" }, ME);
    for (const q of c.calls) expect(q.text).not.toMatch(/\bINSERT\b|\bUPDATE\b/);
  });

  test("the draft is announced on the event log, and only announced", async () => {
    await assist.draft(fakeClient(base()), { threadId: "t-1" }, ME);
    expect(emitEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventTypeKey: "mail.ai.drafted",
    }));
    // 10752's own description: "It landed in the composer. Nothing was sent."
  });

  test("grounding joins the VISIBILITY view, not the base dossier table", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/assist/assist.service.js"), "utf8",
    );
    expect(src).toMatch(/dossier_visible d/);
    // Mail's §9.5 predicate and the AI path have to agree. Joining `dossier`
    // here would make the assistant the one place the rule did not hold.
    expect(src).not.toMatch(/JOIN dossier d\b/);
  });
});
