/**
 * ATTACHMENT FIELD EXTRACTION (§8.6).
 *
 * `attachment_extraction` was created by migration 10751 with four document
 * kinds, a confidence, a match list and an EXTRACTED→REVIEWED/DISMISSED
 * lifecycle, and referenced by no application code at all. The orphan sweep
 * carried it in `KNOWN_UNBUILT` and that entry has now been deleted, which is
 * what these tests are here to keep true.
 *
 * The rule under everything below is the one §8.6 shares with §7.6 and §7.7:
 *
 *   Extraction NEVER writes a business record.
 *
 * A machine-read amount on a scanned receipt is a guess with a decimal point in
 * it, and the modules that own money have approval chains an OCR worker must
 * not be able to skip.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ allowed: true })),
  recordUsage: jest.fn(async () => ({})),
}));
jest.mock("../../src/services/ai/vision.service", () => ({
  extract: jest.fn(async () => ({
    fields: { supplier_name: "Bolloré", invoice_number: "F-2026-77", total_ttc: "1200000", po_number: "PO-2026-0007" },
    raw: "{...}", provider: "gemini",
  })),
}));
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn(async () => ({ vendor: "gemini", api_key: "k", endpoint_url: "u" })),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: jest.fn(async () => ({ doc: { doc_id: "v-1" }, buffer: Buffer.from("pdf") })),
}));

const fs = require("fs");
const path = require("path");
const vision = require("../../src/services/ai/vision.service");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const governance = require("../../src/modules/ai/governance/governance.service");
const { emitEvent, audit } = require("../../src/shared/events/emit");
const ocr = require("../../src/modules/mail/assist/ocr.service");
const handler = require("../../src/jobs/handlers/mail-ocr-extract");

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

/** `mail.ocr` — its own switch, checked in the service because the queue path
 *  never passes through Express. */
const OCR_ON = { match: /feature_key = 'mail\.ocr'/, rows: [{ state: "on" }] };
const ATT = (over = {}) => ({
  match: /FROM email_attachment a/,
  rows: [{ email_attachment_id: "a-1", filename: "facture_bollore.pdf", vault_id: "v-1", content_type: "application/pdf", subject: "Notre facture", ...over }],
});
const SAVED = {
  match: /INSERT INTO attachment_extraction/,
  rows: [{ attachment_extraction_id: "x-1", doc_kind: "SUPPLIER_INVOICE", status: "EXTRACTED" }],
};
const ME = { user_id: "u-me" };

beforeEach(() => {
  jest.clearAllMocks();
  governance.canUseFeature.mockResolvedValue({ allowed: true });
  vision.extract.mockResolvedValue({
    fields: { supplier_name: "Bolloré", invoice_number: "F-2026-77", total_ttc: "1200000", po_number: "PO-2026-0007" },
    raw: "{...}", provider: "gemini",
  });
});

/* ── Kind detection ───────────────────────────────────────────────────────── */

describe("the document kind is guessed before the model is asked", () => {
  test.each([
    ["facture_fournisseur.pdf", "SUPPLIER_INVOICE"],
    ["Invoice 2026.pdf", "SUPPLIER_INVOICE"],
    ["proof_of_payment.jpg", "PROOF_OF_PAYMENT"],
    ["virement swift.pdf", "PROOF_OF_PAYMENT"],
    ["cheque_00123.jpg", "CHEQUE"],
    ["bon de commande.pdf", "CLIENT_PO"],
    ["recu.pdf", "RECEIPT"],
  ])("%s → %s", (filename, kind) => {
    expect(ocr.guessKind({ filename })).toBe(kind);
  });

  test("underscores and dots do not hide the word", () => {
    // The same `\b`-before-`_` trap that hid `connaissement_maersk.pdf` from
    // document intake. Fixed in both places, asserted in both places.
    expect(ocr.guessKind({ filename: "preuve_de_paiement.pdf" })).toBe("PROOF_OF_PAYMENT");
  });

  test("the subject is the weaker signal, used only when the filename says nothing", () => {
    expect(ocr.guessKind({ filename: "scan001.pdf", subject: "our invoice" })).toBe("SUPPLIER_INVOICE");
    expect(ocr.guessKind({ filename: "facture.pdf", subject: "cheque enclosed" })).toBe("SUPPLIER_INVOICE");
  });

  test("unrecognisable is UNKNOWN, and UNKNOWN is a real outcome", () => {
    expect(ocr.guessKind({ filename: "scan001.pdf" })).toBe("UNKNOWN");
    // Stored rather than discarded: it is what stops the same attachment being
    // re-extracted on every sweep, and the only way anyone can see how often
    // extraction fails on this tenant's actual paperwork.
    expect(ocr.KINDS).toContain("UNKNOWN");
  });

  test("every kind the migration allows has an extraction prompt or is UNKNOWN", () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../../migrations/tenant/10751_mail_ocr_extraction.sql"), "utf8",
    );
    for (const k of ocr.KINDS) {
      expect(sql).toContain(`'${k}'`);
      if (k !== "UNKNOWN") expect(ocr.PROMPTS[k]).toBeTruthy();
    }
  });
});

/* ── It stages, it does not file ──────────────────────────────────────────── */

describe("extraction writes ONE staging row and nothing else", () => {
  test("the row lands in attachment_extraction with status EXTRACTED", async () => {
    const c = fakeClient([OCR_ON, ATT(), SAVED]);
    await ocr.extract(c, { attachmentId: "a-1" }, ME);
    const ins = c.written(/INSERT INTO attachment_extraction/)[0];
    expect(ins).toBeTruthy();
    expect(ins.params[1]).toBe("SUPPLIER_INVOICE");
    expect(ins.params[7]).toBe("EXTRACTED");
  });

  test("no business table is touched", async () => {
    const c = fakeClient([OCR_ON, ATT(), SAVED]);
    await ocr.extract(c, { attachmentId: "a-1" }, ME);
    for (const q of c.calls) {
      expect(q.text).not.toMatch(/INSERT INTO (invoice|supplier_invoice|payment|cash_request|receipt)\b/);
      expect(q.text).not.toMatch(/UPDATE (invoice|purchase_order|payment)\b/);
    }
  });

  test("the source file's OWN module writes it, so the whole point is the source", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/assist/ocr.service.js"), "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(/INSERT INTO (\w+)/g) || []).toEqual(["INSERT INTO attachment_extraction"]);
    expect(code.match(/UPDATE (\w+)/g) || []).toEqual([
      "UPDATE attachment_extraction", "UPDATE attachment_extraction",
    ]);
  });

  test("it reads the bytes from the vault rather than re-fetching from the provider", async () => {
    await ocr.extract(fakeClient([OCR_ON, ATT(), SAVED]), { attachmentId: "a-1" }, ME);
    expect(vault.fetchBytes).toHaveBeenCalledWith(expect.anything(), "v-1");
  });

  test("an attachment with no stored bytes is refused, not guessed at", async () => {
    const c = fakeClient([OCR_ON, ATT({ vault_id: null })]);
    await expect(ocr.extract(c, { attachmentId: "a-1" }, ME)).rejects.toMatchObject({ status: 409 });
    expect(vision.extract).not.toHaveBeenCalled();
  });

  test("an attachment that does not exist is a 404", async () => {
    await expect(ocr.extract(fakeClient([OCR_ON]), { attachmentId: "a-1" }, ME))
      .rejects.toMatchObject({ status: 404 });
  });

  test("mail.ocr off refuses before the vendor is called, even from the queue", async () => {
    // The worker never passes through Express, so the route gate cannot be the
    // enforcement. A job enqueued before the tenant switched the feature off
    // would otherwise still bill them.
    const off = fakeClient([{ match: /feature_key = 'mail\.ocr'/, rows: [{ state: "off" }] }]);
    await expect(ocr.extract(off, { attachmentId: "a-1" }, ME)).rejects.toMatchObject({ status: 403 });
    expect(vision.extract).not.toHaveBeenCalled();
  });
});

/* ── Matches are proposals ────────────────────────────────────────────────── */

describe("candidate records are searched, never created", () => {
  test("a PO number on the invoice finds the PO", async () => {
    const c = fakeClient([
      OCR_ON, ATT(), SAVED,
      { match: /FROM purchase_order WHERE doc_number/, rows: [{ po_id: "po-1", doc_number: "PO-2026-0007" }] },
    ]);
    await ocr.extract(c, { attachmentId: "a-1" }, ME);
    const matches = JSON.parse(c.written(/INSERT INTO attachment_extraction/)[0].params[4]);
    expect(matches).toContainEqual(expect.objectContaining({ kind: "purchase_order", id: "po-1", on: "po_number" }));
  });

  test("a match names the FIELD that produced it", async () => {
    const found = await ocr.findMatches(
      fakeClient([{ match: /FROM supplier_master/, rows: [{ supplier_id: "s-1", name: "Bolloré Trading" }] }]),
      "SUPPLIER_INVOICE", { supplier_name: "Bolloré" },
    );
    // A bare list of numbers makes the reviewer re-do the search. "We think
    // this because the supplier name matched" lets them agree or disagree.
    expect(found[0].on).toBe("supplier_name");
  });

  test("a high-confidence match still requires the same click as a low one", async () => {
    const c = fakeClient([
      OCR_ON, ATT(), SAVED,
      { match: /FROM purchase_order WHERE doc_number/, rows: [{ po_id: "po-1", doc_number: "PO-2026-0007" }] },
    ]);
    await ocr.extract(c, { attachmentId: "a-1" }, ME);
    // Status is EXTRACTED regardless — there is no confidence at which this
    // auto-files, in this programme, ever.
    expect(c.written(/INSERT INTO attachment_extraction/)[0].params[7]).toBe("EXTRACTED");
  });

  test("a failed lookup does not fail the extraction", async () => {
    const c = {
      query: async (text) => {
        if (/feature_key = 'mail\.ocr'/.test(text)) return { rows: [{ state: "on" }] };
        if (/FROM purchase_order/.test(text)) throw new Error("relation missing");
        if (/FROM email_attachment a/.test(text)) return { rows: ATT().rows };
        if (/INSERT INTO attachment_extraction/.test(text)) return { rows: SAVED.rows };
        return { rows: [] };
      },
    };
    const out = await ocr.extract(c, { attachmentId: "a-1" }, ME);
    expect(out.status).toBe("EXTRACTED");
  });
});

/* ── Confidence, failure, cost ────────────────────────────────────────────── */

describe("confidence is coverage, and failure is data", () => {
  test("confidence rises with how many requested fields came back", async () => {
    const c1 = fakeClient([OCR_ON, ATT(), SAVED]);
    await ocr.extract(c1, { attachmentId: "a-1" }, ME);
    const full = Number(c1.written(/INSERT INTO attachment_extraction/)[0].params[5]);

    vision.extract.mockResolvedValue({ fields: { supplier_name: "Bolloré" }, raw: "", provider: "gemini" });
    const c2 = fakeClient([OCR_ON, ATT(), SAVED]);
    await ocr.extract(c2, { attachmentId: "a-1" }, ME);
    const thin = Number(c2.written(/INSERT INTO attachment_extraction/)[0].params[5]);

    expect(full).toBeGreaterThan(thin);
    // Derived from coverage, NOT from anything the model says about itself: a
    // model's self-assessed confidence is a number it generated, and treating
    // it as evidence about its own output is circular.
  });

  test("a vision failure writes a FAILED row instead of throwing", async () => {
    vision.extract.mockRejectedValue(new Error("provider timeout"));
    const c = fakeClient([OCR_ON, ATT(), { match: /INSERT INTO attachment_extraction/, rows: [{ status: "FAILED" }] }]);
    const out = await ocr.extract(c, { attachmentId: "a-1" }, ME);
    expect(out.status).toBe("FAILED");
    // Otherwise a scan our provider cannot read looks identical to one nobody
    // has got to yet, and it sits in the queue forever.
    expect(c.written(/INSERT INTO attachment_extraction/)[0].params[7]).toBe("FAILED");
  });

  test("every extraction is metered, including a failed one", async () => {
    vision.extract.mockRejectedValue(new Error("nope"));
    await ocr.extract(fakeClient([OCR_ON, ATT(), SAVED]), { attachmentId: "a-1" }, ME);
    expect(governance.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      featureKey: "mail_ai", wasSuccessful: false,
    }));
  });

  test("the metering sub-type names the document kind", async () => {
    await ocr.extract(fakeClient([OCR_ON, ATT(), SAVED]), { attachmentId: "a-1" }, ME);
    expect(governance.recordUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      callType: "ocr.supplier_invoice",
    }));
  });

  test("AI off refuses before the vendor is called", async () => {
    governance.canUseFeature.mockResolvedValue({ allowed: false, reason: "budget exhausted" });
    await expect(ocr.extract(fakeClient([OCR_ON, ATT()]), { attachmentId: "a-1" }, ME)).rejects.toThrow(/budget exhausted/);
    expect(vision.extract).not.toHaveBeenCalled();
  });

  test("an already-extracted attachment is not re-billed", async () => {
    const c = fakeClient([
      OCR_ON,
      { match: /SELECT \* FROM attachment_extraction WHERE email_attachment_id/, rows: [{ attachment_extraction_id: "x-0" }] },
    ]);
    const out = await ocr.extract(c, { attachmentId: "a-1" }, ME);
    expect(out.reused).toBe(true);
    // BullMQ is at-least-once with attempts: 3. A timeout during a call that
    // actually succeeded WILL be redelivered.
    expect(vision.extract).not.toHaveBeenCalled();
  });

  test("force re-runs it, deliberately", async () => {
    const c = fakeClient([
      OCR_ON,
      { match: /SELECT \* FROM attachment_extraction WHERE email_attachment_id/, rows: [{ attachment_extraction_id: "x-0" }] },
      ATT(), SAVED,
    ]);
    await ocr.extract(c, { attachmentId: "a-1", force: true }, ME);
    expect(vision.extract).toHaveBeenCalled();
  });

  test("it is on the event log", async () => {
    await ocr.extract(fakeClient([OCR_ON, ATT(), SAVED]), { attachmentId: "a-1" }, ME);
    expect(emitEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventTypeKey: "mail.ocr.extracted",
    }));
  });
});

/* ── Review ───────────────────────────────────────────────────────────────── */

describe("review is where a human's reading wins", () => {
  // C-4. review/dismiss now resolve the extraction to its thread and apply
  // §9.5 before they write. A fixture that only answers the UPDATE 404s on
  // the gate and never reaches the write.
  const visible = { match: /FROM attachment_extraction e/, rows: [{ attachment_extraction_id: "x-1" }] };
  const reviewed = [
    visible,
    { match: /UPDATE attachment_extraction/, rows: [{ attachment_extraction_id: "x-1", status: "REVIEWED" }] },
  ];

  test("corrected fields overwrite the machine's", async () => {
    const c = fakeClient(reviewed);
    await ocr.review(c, "x-1", { fields: { invoice_number: "F-2026-78" } }, ME);
    const u = c.written(/UPDATE attachment_extraction/)[0];
    expect(JSON.parse(u.params[1]).invoice_number).toBe("F-2026-78");
    // A review that keeps the model's version and merely notes that someone
    // looked is a rubber stamp with extra steps.
  });

  test("no correction leaves the extracted fields alone", async () => {
    const c = fakeClient(reviewed);
    await ocr.review(c, "x-1", {}, ME);
    expect(c.written(/UPDATE attachment_extraction/)[0].params[1]).toBeNull();
    expect(c.written(/UPDATE attachment_extraction/)[0].text).toMatch(/COALESCE\(\$2::jsonb, fields\)/);
  });

  test("the reviewer is recorded, in the ledger as well as the row", async () => {
    const c = fakeClient(reviewed);
    await ocr.review(c, "x-1", {}, ME);
    expect(c.written(/UPDATE attachment_extraction/)[0].params[2]).toBe("u-me");
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.ocr.reviewed", actorUserId: "u-me",
    }));
  });

  test("reviewing twice is refused", async () => {
    await expect(ocr.review(fakeClient([visible]), "x-1", {}, ME)).rejects.toMatchObject({ status: 409 });
  });

  test("an extraction on a thread the caller cannot see is a 404", async () => {
    await expect(ocr.review(fakeClient(), "x-1", {}, ME)).rejects.toMatchObject({ status: 404 });
  });

  test("dismissing keeps the row so it is not re-extracted", async () => {
    const c = fakeClient([
      visible,
      { match: /SET status = 'DISMISSED'/, rows: [{ status: "DISMISSED" }] },
    ]);
    await ocr.dismiss(c, "x-1", ME);
    const q = c.written(/SET status = 'DISMISSED'/)[0];
    // An UPDATE, not a DELETE. Keeping the row is what stops the same
    // attachment being re-proposed forever, and it is the only way "how often
    // is extraction wrong on this tenant's paperwork" stays answerable.
    expect(q.text).toMatch(/^\s*UPDATE attachment_extraction/);
    expect(q.text).not.toMatch(/DELETE/);
    expect(q.text).toMatch(/status IN \('EXTRACTED','FAILED'\)/);
  });
});

/* ── The worker ───────────────────────────────────────────────────────────── */

describe("the queue handler is registered AND enqueued", () => {
  test("the worker table names it", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/jobs/workers.js"), "utf8");
    // A handler file that no worker registers is the same class of defect as a
    // table no code reads — it exists in the tree and not in the product.
    expect(src).toMatch(/name: "mail-ocr-extract"/);
    expect(src).toMatch(/handlers\/mail-ocr-extract/);
  });

  test("SOMETHING ENQUEUES IT — a registered worker is only half a wiring", () => {
    const src = (function walk(dir, acc = []) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (e.name.endsWith(".js") && !p.endsWith("handlers/mail-ocr-extract.js")) {
          acc.push(fs.readFileSync(p, "utf8"));
        }
      }
      return acc;
    })(path.resolve(__dirname, "../../src")).join("\n");
    // This is the finding that made the file exist. The handler was written,
    // registered in `workers.js`, and enqueued by nothing — reintroducing, in
    // the commit that closed the last orphan table, the same defect in a
    // different shape. `workers.js` is where you go to check that a job
    // exists, which is exactly why registration alone reads as finished.
    const enqueues = src.match(/enqueue\(\s*\n?\s*"mail-ocr-extract"/g) || [];
    expect(enqueues.length).toBeGreaterThan(0);
  });

  test("the ingest path is the thing that enqueues it", () => {
    const svc = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/mail/mail.service.js"), "utf8",
    );
    expect(svc).toMatch(/ocrQueue\.forMessage\(/);
  });

  test("it refuses a job with no attachment rather than sweeping the mailbox", async () => {
    await expect(handler({ data: { tenantMeta: {} } })).rejects.toThrow(/attachmentId/);
    await expect(handler({ data: { attachmentId: "a-1" } })).rejects.toThrow(/tenantMeta/);
  });
});
