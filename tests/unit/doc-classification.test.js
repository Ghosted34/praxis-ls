/**
 * Inbound document intake (§7.6, §7.10, §7.9 criterion 12).
 *
 * `document_requirement` and `email_attachment_classification` were created by
 * migration 10747 and read by nothing, so the attachment strip never offered
 * "Looks like a Bill of Lading for SLAS-2026-0042 — File it?", the Documents
 * tab had no checklist, and "Chase missing documents" had nothing to chase.
 *
 * The rule this file exists to hold is one sentence and has no exceptions:
 *
 *   "MUST: never file silently, at any confidence, in this programme."
 *
 * Everything else here is in service of that — a suggestion is a row, a filing
 * is an act with an actor's name on it, and the two are different code paths.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));

const { emitEvent, audit } = require("../../src/shared/events/emit");
const intake = require("../../src/modules/mail/binding/intake.service");

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

const ME = { user_id: "u-me" };
beforeEach(() => jest.clearAllMocks());

/* ── Classification ───────────────────────────────────────────────────────── */

describe("classification reads the filename first", () => {
  test.each([
    ["BL-SLAS-2026-0042.pdf", "BL"],
    ["connaissement_maersk.pdf", "BL"],
    ["MAWB 057-12345678.pdf", "MAWB"],
    ["packing list.xlsx", "PACKING_LIST"],
    ["liste de colisage.pdf", "PACKING_LIST"],
    ["APEC-2026.pdf", "APEC"],
    ["Facture INV-2026-0311.pdf", "INVOICE"],
    ["proof of delivery.jpg", "POD"],
  ])("%s → %s", (filename, code) => {
    expect(intake.classify({ filename }).doc_type_code).toBe(code);
  });

  test("the subject is a weaker signal than the filename, and scores lower", () => {
    const strong = intake.classify({ filename: "invoice.pdf" });
    const weak = intake.classify({ filename: "scan001.pdf", subject: "our invoice" });
    expect(strong.matched_on).toBe("filename");
    expect(weak.matched_on).toBe("subject");
    // A subject saying "invoice" while the attachment is called scan001.pdf is
    // genuinely less certain, and the confidence should say so.
    expect(weak.confidence).toBeLessThan(strong.confidence);
  });

  test("nothing recognisable returns null, not OTHER", () => {
    // `OTHER` is a decision. This function is not entitled to make one.
    expect(intake.classify({ filename: "scan001.pdf", subject: "hello" })).toBeNull();
  });

  test("confidences are comparable with a binding suggestion's", () => {
    for (const p of intake.PATTERNS) {
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });
});

/* ── Suggesting ───────────────────────────────────────────────────────────── */

describe("ingest proposes, and only proposes", () => {
  const withAttachment = (filename) => [
    { match: /FROM email_attachment a/, rows: [{ email_attachment_id: "a-1", filename, vault_id: "v-1" }] },
    { match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: "dossier:d-1" }] },
  ];

  test("a recognised attachment becomes a SUGGESTED row", async () => {
    const c = fakeClient(withAttachment("BL-SLAS-2026-0042.pdf"));
    const out = await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1", subject: "BL" });
    expect(out.suggested).toBe(1);
    const ins = c.written(/INSERT INTO email_attachment_classification/)[0];
    expect(ins.text).toMatch(/'SUGGESTED'/);
    expect(ins.params[1]).toBe("BL");
    expect(ins.params[2]).toBe("dossier:d-1");
  });

  test("NOTHING is filed — no vault write, no document.captured", async () => {
    const c = fakeClient(withAttachment("BL.pdf"));
    await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1" });
    expect(c.written(/UPDATE document_vault/)).toHaveLength(0);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  test("an unrecognised attachment produces no row at all", async () => {
    const c = fakeClient(withAttachment("scan001.pdf"));
    const out = await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1" });
    expect(out.suggested).toBe(0);
    expect(c.written(/INSERT INTO email_attachment_classification/)).toHaveLength(0);
  });

  test("an unbound thread still gets a doc-type suggestion", async () => {
    const c = fakeClient([
      { match: /FROM email_attachment a/, rows: [{ email_attachment_id: "a-1", filename: "BL.pdf", vault_id: "v-1" }] },
      { match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: null }] },
    ]);
    await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1" });
    // "This is a Bill of Lading" is useful before anyone has said whose it is.
    expect(c.written(/INSERT INTO email_attachment_classification/)[0].params[2]).toBeNull();
  });

  test("an attachment already classified is not re-proposed", async () => {
    const c = fakeClient(withAttachment("BL.pdf"));
    await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1" });
    expect(c.calls[0].text).toMatch(/NOT EXISTS \(SELECT 1 FROM email_attachment_classification/);
  });

  test("it reads the RENAMED column — 10737 made it email_message_id", async () => {
    const c = fakeClient(withAttachment("BL.pdf"));
    await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1" });
    expect(c.calls[0].text).toMatch(/a\.email_message_id = \$1/);
    expect(c.calls[0].text).not.toMatch(/email_inbound_id/);
  });

  test("a message with no attachments does no work", async () => {
    const c = fakeClient();
    expect(await intake.suggestForMessage(c, { messageId: "m-1", threadId: "t-1" })).toEqual({ suggested: 0 });
    expect(c.calls).toHaveLength(1);
  });
});

/* ── Filing ───────────────────────────────────────────────────────────────── */

describe("filing is the only path to a document, and it has a name on it", () => {
  const ready = (over = {}) => ([
    {
      match: /FROM email_attachment_classification k/,
      rows: [{
        email_attachment_classification_id: "k-1", status: "SUGGESTED",
        suggested_doc_type_code: "BL", suggested_entity_ref: "client:c-1",
        vault_id: "v-1", ...over,
      }],
    },
    { match: /FROM dictionary_ref WHERE kind = 'DOCUMENT_TYPE'/, rows: [{ ref_id: "ref-bl" }] },
    { match: /UPDATE email_attachment_classification/, rows: [{ email_attachment_classification_id: "k-1", status: "FILED" }] },
  ]);

  test("it sets the doc type and the client on the vault row", async () => {
    const c = fakeClient(ready());
    await intake.accept(c, "k-1", {}, ME);
    const u = c.written(/UPDATE document_vault/)[0];
    expect(u.params).toEqual(["v-1", "ref-bl", "c-1"]);
  });

  test("it emits document.captured, which is what puts it in Client 360", async () => {
    await intake.accept(fakeClient(ready()), "k-1", {}, ME);
    expect(emitEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventTypeKey: "document.captured",
      entityRef: "client:c-1",
    }));
  });

  test("the human's correction beats the machine's guess", async () => {
    const c = fakeClient([
      ...ready(),
      { match: /FROM dictionary_ref WHERE kind = 'DOCUMENT_TYPE'/, rows: [{ ref_id: "ref-mawb" }] },
    ]);
    await intake.accept(c, "k-1", { docTypeCode: "MAWB", entityRef: "client:c-9" }, ME);
    // Otherwise the confirm dialog is decorative.
    expect(c.written(/FROM dictionary_ref/)[0].params[0]).toBe("MAWB");
    expect(c.written(/UPDATE document_vault/)[0].params[2]).toBe("c-9");
  });

  test("the actor is recorded", async () => {
    const c = fakeClient(ready());
    await intake.accept(c, "k-1", {}, ME);
    expect(c.written(/UPDATE email_attachment_classification/)[0].params[2]).toBe("u-me");
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.document.filed", actorUserId: "u-me",
    }));
  });

  test("filing twice is refused rather than duplicating the document", async () => {
    const c = fakeClient(ready({ status: "FILED" }));
    await expect(intake.accept(c, "k-1", {}, ME)).rejects.toMatchObject({ status: 409 });
  });

  test("a doc type the tenant does not have is refused, not invented", async () => {
    const c = fakeClient([ready()[0]]);
    await expect(intake.accept(c, "k-1", { docTypeCode: "NONSENSE" }, ME))
      .rejects.toThrow(/is not a document type in this tenant/);
  });

  test("a suggestion with no type at all cannot be filed blind", async () => {
    const c = fakeClient(ready({ suggested_doc_type_code: null }));
    await expect(intake.accept(c, "k-1", {}, ME)).rejects.toMatchObject({ status: 422 });
  });

  test("rejecting keeps the row, so the same file is not re-proposed forever", async () => {
    const c = fakeClient([{ match: /SET status = 'REJECTED'/, rows: [{ status: "REJECTED" }] }]);
    await intake.reject(c, "k-1", ME);
    const q = c.written(/SET status = 'REJECTED'/)[0];
    expect(q.text).toMatch(/status = 'SUGGESTED'/); // only an open one
    expect(q.params[1]).toBe("u-me");
  });
});

/* ── The chase composer ───────────────────────────────────────────────────── */

describe("the chase lists exactly what is outstanding", () => {
  test("it asks only for documents that are actually missing", async () => {
    const c = fakeClient([
      { match: /FROM document_requirement r/, rows: [{ doc_type_code: "RCCM", name_en: "RCCM", name_fr: "RCCM", is_mandatory: true }] },
      { match: /SELECT preferred_language/, rows: [{ preferred_language: "fr" }] },
    ]);
    const out = await intake.chaseList(c, "c-1");
    expect(out.missing).toHaveLength(1);
    expect(out.language).toBe("fr");
    // A chase listing documents the client already sent is worse than no chase:
    // it tells them nobody looked.
    expect(c.calls[0].text).toMatch(/NOT EXISTS/);
  });

  test("it carries both languages, so the snippet can be bilingual", async () => {
    const c = fakeClient([
      { match: /FROM document_requirement r/, rows: [{ doc_type_code: "BL", name_en: "Bill of Lading", name_fr: "Connaissement" }] },
    ]);
    const out = await intake.chaseList(c, "c-1");
    expect(out.missing[0]).toMatchObject({ name_en: "Bill of Lading", name_fr: "Connaissement" });
  });

  test("nothing outstanding is a real answer, not an empty chase", async () => {
    const out = await intake.chaseList(fakeClient(), "c-1");
    expect(out.nothing_outstanding).toBe(true);
    expect(out.missing).toEqual([]);
  });
});
