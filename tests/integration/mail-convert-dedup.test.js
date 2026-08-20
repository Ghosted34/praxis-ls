/**
 * Turning an email into an ERP record (§7.7, §7.10, §7.9 criterion 13).
 *
 * Two things were wrong. Conversion returned a prefill and a duplicate list
 * built from ONE signal — a lead whose email string was exactly equal — which
 * misses every duplicate that actually happens: the same company writing from a
 * second address, a name spelled with or without SARL, a person who moved off
 * Gmail. And `converted_entity_ref` / `converted_by`, added by migration 10748
 * for the other half of "bidirectional in the record", were written by nothing,
 * so a thread never showed what it became.
 *
 * The non-negotiable, which every test below is arranged around: this PREVIEWS.
 * Q23 = B, always confirm. The record is created by the target module, under
 * its own rights, from a form a human reviewed.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));
jest.mock("../../src/modules/master/_shared/dedup.service", () => ({
  findDuplicates: jest.fn(async () => []),
}));

const fs = require("fs");
const path = require("path");
const { emitEvent, audit } = require("../../src/shared/events/emit");
const dedup = require("../../src/modules/master/_shared/dedup.service");
const convert = require("../../src/modules/mail/binding/convert.service");

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

const thread = (over = {}) => ([{
  match: /FROM email_thread t/,
  rows: [{
    email_thread_id: "t-1", subject: "Quote for 2x40HC Douala–Yaoundé",
    entity_ref: null, participants: ["thierry@camrail.cm"],
    from_address: "Thierry@Camrail.cm", from_name: "Thierry Mbarga",
    body_text: "Please quote for two containers.", received_at: new Date(),
    ...over,
  }],
}]);

const ME = { user_id: "u-me" };
beforeEach(() => {
  jest.clearAllMocks();
  dedup.findDuplicates.mockResolvedValue([]);
});

/* ── It previews ──────────────────────────────────────────────────────────── */

describe("conversion previews and never creates", () => {
  test("no business record is written", async () => {
    const c = fakeClient(thread());
    await convert.preview(c, "t-1", "lead");
    for (const q of c.calls) expect(q.text).not.toMatch(/\bINSERT\b|\bUPDATE\b/);
  });

  test("it names the module whose rights govern the create", async () => {
    const out = await convert.preview(fakeClient(thread()), "t-1", "lead");
    // §3.4: "a lead is created under MOD-26's rights, not mail's". Returned so
    // the UI can grey the option rather than letting someone fill a form and be
    // refused at the end.
    expect(out.target_module).toBe("MOD-26");
    expect(out.target_route).toMatch(/leads/);
  });

  test.each([
    ["lead", "MOD-26"], ["quote_request", "MOD-25"], ["enquiry", "MOD-25"],
    ["ticket", "MOD-25"], ["task", "MOD-72"], ["purchase_requisition", "MOD-56"],
  ])("%s is a declared target owned by %s", async (target, module) => {
    const out = await convert.preview(fakeClient(thread()), "t-1", target);
    expect(out.target_module).toBe(module);
  });

  test("all six §7.7 targets exist", () => {
    expect(Object.keys(convert.TARGETS).sort()).toEqual([
      "enquiry", "lead", "purchase_requisition", "quote_request", "task", "ticket",
    ]);
  });

  test("an unknown target is refused", async () => {
    await expect(convert.preview(fakeClient(thread()), "t-1", "spaceship"))
      .rejects.toMatchObject({ status: 422 });
  });
});

/* ── The prefill is honest ────────────────────────────────────────────────── */

describe("the prefill contains what the thread says, and nothing else", () => {
  test("the sender's address and display name come through", async () => {
    const out = await convert.preview(fakeClient(thread()), "t-1", "lead");
    expect(out.prefill.email).toBe("thierry@camrail.cm");
    expect(out.prefill.contact_name).toBe("Thierry Mbarga");
    expect(out.prefill.subject).toMatch(/Quote for/);
  });

  test("a person's name does not become a company name", async () => {
    const out = await convert.preview(fakeClient(thread()), "t-1", "lead");
    // Conflating the two is how a client ends up named after whoever happened
    // to send the first email.
    expect(out.prefill.company_name).toBeNull();
  });

  test("a name that IS a company does", async () => {
    const out = await convert.preview(fakeClient(thread({ from_name: "Camrail SARL" })), "t-1", "lead");
    expect(out.prefill.company_name).toBe("Camrail SARL");
  });

  test("nothing is derived from the email DOMAIN", async () => {
    const out = await convert.preview(
      fakeClient(thread({ from_name: null, from_address: "info@camrail.cm" })), "t-1", "lead",
    );
    // Guessing "Camrail" from camrail.cm is the kind of help that produces a
    // client called Gmail.
    expect(out.prefill.company_name).toBeNull();
    expect(out.prefill.contact_name).toBeNull();
  });

  test.each([
    ["Camrail SARL", true], ["Maersk Logistics", true], ["Bolloré Trading", true],
    ["Thierry Mbarga", false], ["Marie", false],
  ])("looksLikeCompany(%s) === %s", (name, expected) => {
    expect(convert.looksLikeCompany(name)).toBe(expected);
  });

  test("a thread that does not exist is a 404", async () => {
    await expect(convert.preview(fakeClient(), "t-1", "lead")).rejects.toMatchObject({ status: 404 });
  });
});

/* ── Duplicate detection ──────────────────────────────────────────────────── */

describe("duplicates are found by the shared detector, not by string equality", () => {
  test("it goes through master/_shared/dedup, with name AND email", async () => {
    await convert.preview(fakeClient(thread({ from_name: "Camrail SARL" })), "t-1", "lead");
    expect(dedup.findDuplicates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: "client",
      input: { name: "Camrail SARL", email: "thierry@camrail.cm" },
    }));
    // Reusing it keeps mail's idea of "the same company" identical to Master
    // Data's — trigram name, tax id, email, phone and bank, not one string.
  });

  test("a supplier-side target searches the SUPPLIER corpus", async () => {
    await convert.preview(fakeClient(thread()), "t-1", "purchase_requisition");
    expect(dedup.findDuplicates.mock.calls[0][1].kind).toBe("supplier");
  });

  test("a ticket does not duplicate-detect at all", async () => {
    await convert.preview(fakeClient(thread()), "t-1", "ticket");
    // A ticket belongs to whoever wrote in; matching them by company name would
    // merge two unrelated problems.
    expect(dedup.findDuplicates).not.toHaveBeenCalled();
  });

  test("a match makes ATTACHING the primary action", async () => {
    dedup.findDuplicates.mockResolvedValue([{ id: "l-9", name: "Camrail", score: 90 }]);
    const out = await convert.preview(fakeClient(thread()), "t-1", "lead");
    // §7.7: the dialog "leads with 'already a lead — attach this email to it?'
    // and makes Create new the SECONDARY action".
    expect(out.primary_action).toBe("ATTACH_EXISTING");
    expect(out.hint).toMatch(/may already exist/);
  });

  test("no match makes creating the primary action, with no hint", async () => {
    const out = await convert.preview(fakeClient(thread()), "t-1", "lead");
    expect(out.primary_action).toBe("CREATE_NEW");
    expect(out.hint).toBeNull();
  });

  test("a dedup failure degrades to no duplicates rather than blocking conversion", async () => {
    dedup.findDuplicates.mockRejectedValue(new Error("trgm extension missing"));
    const out = await convert.preview(fakeClient(thread()), "t-1", "lead");
    expect(out.duplicates).toEqual([]);
    expect(out.primary_action).toBe("CREATE_NEW");
  });
});

/* ── The back-reference ───────────────────────────────────────────────────── */

describe("the thread shows what it became", () => {
  const converted = [{
    match: /UPDATE email_thread/,
    rows: [{ email_thread_id: "t-1", entity_ref: "lead:l-1", converted_entity_ref: "lead:l-1", converted_by: "u-me" }],
  }];

  test("converted_entity_ref and converted_by are written", async () => {
    const c = fakeClient(converted);
    await convert.recordConversion(c, "t-1", "lead:l-1", ME);
    const u = c.written(/UPDATE email_thread/)[0];
    // Both columns were added by 10748 and written by nothing, so the second
    // half of "bidirectional in the record" was not true.
    expect(u.text).toMatch(/converted_entity_ref = \$2/);
    expect(u.text).toMatch(/converted_by = \$3/);
    expect(u.params).toEqual(["t-1", "lead:l-1", "u-me"]);
  });

  test("binding follows conversion, but never overwrites a human's choice", async () => {
    const c = fakeClient(converted);
    await convert.recordConversion(c, "t-1", "lead:l-1", ME);
    expect(c.written(/UPDATE email_thread/)[0].text).toMatch(/entity_ref = COALESCE\(entity_ref, \$2\)/);
  });

  test("it is on the event log and the audit trail", async () => {
    await convert.recordConversion(fakeClient(converted), "t-1", "lead:l-1", ME);
    expect(emitEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventTypeKey: "email.thread.converted",
    }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "email.thread.converted", actorUserId: "u-me",
    }));
  });

  test("a malformed reference is refused", async () => {
    await expect(convert.recordConversion(fakeClient(), "t-1", "just-an-id", ME))
      .rejects.toMatchObject({ status: 422 });
  });

  test("recording against a thread that does not exist is a 404", async () => {
    await expect(convert.recordConversion(fakeClient(), "t-1", "lead:l-1", ME))
      .rejects.toMatchObject({ status: 404 });
  });

  test("mail writes only its OWN columns here", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/binding/convert.service.js"), "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Mail records the link. It does not make the record.
    expect(code).not.toMatch(/INSERT INTO (lead|client_master|supplier_master|quotation)/);
    expect(code.match(/UPDATE (\w+)/g) || []).toEqual(["UPDATE email_thread"]);
  });
});
