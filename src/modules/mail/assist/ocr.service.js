/**
 * ATTACHMENT FIELD EXTRACTION — the staging table, and why it is a staging
 * table (§8.6).
 *
 * `attachment_extraction` was created by migration 10751 and referenced by no
 * application code at all. Four document kinds, a confidence, a match list and
 * a REVIEWED/DISMISSED lifecycle, all of it inert.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * Extraction NEVER writes a business record. Not a supplier invoice, not a
 * receipt, not a payment. It writes ONE row to `attachment_extraction` with
 * status EXTRACTED, and that row is a proposal a human either accepts (by
 * opening the target module's form, prefilled) or dismisses. This is the same
 * shape as §7.6's document intake and §7.7's conversion, and for the same
 * reason: a machine-read amount on a scanned receipt is a guess with a decimal
 * point in it, and the modules that own money have their own approval chains
 * which an OCR worker must not be able to skip.
 *
 * `matches` exists to make accepting cheap without making it automatic: it
 * carries the candidate records the extracted fields point at — the PO whose
 * number appears on the invoice, the supplier whose name matches — so the
 * reviewer confirms a link rather than searching for one. A match at 0.99 and a
 * match at 0.41 both require the same click.
 *
 * ── WHY THE WORK IS A JOB AND NOT PART OF SYNC ──────────────────────────────
 *
 * Vision calls take seconds and cost money. A first sync at the 90-day default
 * depth can pull thousands of attachments. Doing this inline would make the
 * mailbox appear broken for the length of the sync and bill the tenant for
 * extracting three-month-old receipts nobody asked about. So sync SUGGESTS
 * (`binding/intake.service`) and this runs on demand or on a queue, per
 * attachment.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const vault = require("../../vault/document_vault/document_vault.service");
const vision = require("../../../services/ai/vision.service");
const platformVendors = require("../../../services/platform/ai-vendor.service");
const governance = require("../../ai/governance/governance.service");
const threadRepo = require("../mail/thread.repo");

const MODULE = "MOD-72";
const FEATURE = "mail_ai";

/**
 * The four kinds §8.6 names, plus UNKNOWN.
 *
 * UNKNOWN is a real outcome and it is stored, not discarded: a row saying "we
 * looked at this and could not tell" is what stops the same attachment being
 * re-extracted on every sweep, and it is the only way anyone can see how often
 * extraction fails on this tenant's actual paperwork.
 */
const KINDS = ["SUPPLIER_INVOICE", "RECEIPT", "CLIENT_PO", "PROOF_OF_PAYMENT", "CHEQUE", "UNKNOWN"];

/** What we ask the model for, per kind. Field names are the target form's. */
const PROMPTS = {
  SUPPLIER_INVOICE: "supplier_name, invoice_number, invoice_date, due_date, currency, total_ttc, total_ht, tax_amount, po_number",
  RECEIPT: "merchant_name, receipt_date, currency, total_amount, tax_amount, payment_method",
  CLIENT_PO: "client_name, po_number, po_date, currency, total_amount, delivery_date, incoterm",
  PROOF_OF_PAYMENT: "payer_name, beneficiary_name, payment_date, currency, amount, reference, bank_name",
  CHEQUE: "bank_name, cheque_number, cheque_date, currency, amount, beneficiary_name",
};

const KIND_HINTS = [
  { kind: "SUPPLIER_INVOICE", re: /invoice|facture|fournisseur/i },
  { kind: "PROOF_OF_PAYMENT", re: /(proof|preuve).{0,12}(of )?(payment|paiement)|virement|swift|remittance/i },
  { kind: "CHEQUE", re: /\bcheque\b|\bcheck\b|\bch[eè]que\b/i },
  { kind: "CLIENT_PO", re: /purchase.?order|bon de commande|\bPO[-_ ]?\d/i },
  { kind: "RECEIPT", re: /receipt|re[cç]u|ticket de caisse/i },
];

/** Filename first, subject second — same precedence as document intake. */
function guessKind({ filename, subject } = {}) {
  const name = String(filename || "").replace(/[_.]+/g, " ");
  for (const h of KIND_HINTS) if (h.re.test(name)) return h.kind;
  for (const h of KIND_HINTS) if (h.re.test(String(subject || ""))) return h.kind;
  return "UNKNOWN";
}

/**
 * Candidate records the extracted fields point at.
 *
 * Searched, not created. Each match is `{ kind, id, label, on }` where `on`
 * names the field that produced it, so the reviewer sees WHY we think this is
 * the right PO rather than a bare list of numbers.
 */
async function findMatches(client, kind, fields = {}) {
  const matches = [];
  const push = (m) => { if (m) matches.push(m); };

  const poNumber = fields.po_number || (kind === "CLIENT_PO" ? fields.po_number : null);
  if (poNumber) {
    const { rows } = await client.query(
      "SELECT po_id, doc_number, total_ttc FROM purchase_order WHERE doc_number = $1 LIMIT 3",
      [String(poNumber)],
    ).catch(() => ({ rows: [] }));
    for (const r of rows) {
      push({ kind: "purchase_order", id: r.po_id, label: r.doc_number, on: "po_number" });
    }
  }

  const supplierName = fields.supplier_name || fields.beneficiary_name || fields.merchant_name;
  if (supplierName) {
    const { rows } = await client.query(
      "SELECT supplier_id, name FROM supplier_master WHERE is_active AND name ILIKE $1 LIMIT 3",
      [`%${String(supplierName).slice(0, 60)}%`],
    ).catch(() => ({ rows: [] }));
    for (const r of rows) push({ kind: "supplier", id: r.supplier_id, label: r.name, on: "supplier_name" });
  }

  const clientName = fields.client_name || fields.payer_name;
  if (clientName) {
    const { rows } = await client.query(
      "SELECT client_id, name FROM client_master WHERE is_active AND name ILIKE $1 LIMIT 3",
      [`%${String(clientName).slice(0, 60)}%`],
    ).catch(() => ({ rows: [] }));
    for (const r of rows) push({ kind: "client", id: r.client_id, label: r.name, on: "client_name" });
  }

  return matches;
}

/**
 * Extract one attachment. Idempotent per attachment: a second call returns the
 * existing row rather than paying for the same vision call twice, because the
 * queue is at-least-once and a redelivery must not double-bill the tenant.
 */
async function extract(client, { attachmentId, force = false } = {}, user = null) {
  // Its own switch, checked HERE and not only on the route: the queue path
  // reaches this function from a BullMQ worker, which never passes through
  // Express, and a job enqueued before the tenant turned the feature off would
  // otherwise still bill them for a vision call. `ocr.enqueue` checks it too —
  // that is a cheap early exit, not the enforcement.
  const { rows: flag } = await client.query(
    "SELECT state FROM feature_state WHERE feature_key = 'mail.ocr'",
  ).catch(() => ({ rows: [] }));
  if (!flag[0] || flag[0].state !== "on") {
    throw new AppError("FEATURE_DISABLED", "Attachment extraction is off for this tenant.", 403);
  }

  const gate = await governance.canUseFeature(client, {
    userId: user && user.user_id,
    featureKey: FEATURE,
  });
  if (!gate.allowed) throw new AppError("AI_UNAVAILABLE", `OCR is unavailable: ${gate.reason || "not enabled"}.`, 403);

  const { rows: existing } = await client.query(
    "SELECT * FROM attachment_extraction WHERE email_attachment_id = $1 ORDER BY created_at DESC LIMIT 1",
    [attachmentId],
  );
  if (existing[0] && !force) return { ...existing[0], reused: true };

  const { rows: att } = await client.query(
    `SELECT a.email_attachment_id, a.filename, a.vault_id, a.content_type, m.subject
       FROM email_attachment a
       LEFT JOIN email_message m ON m.email_message_id = a.email_message_id
      WHERE a.email_attachment_id = $1`,
    [attachmentId],
  );
  const row = att[0];
  if (!row) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  if (!row.vault_id) throw new AppError("NOT_STORED", "This attachment has no stored bytes to read.", 409);

  const kind = guessKind(row);
  const started = Date.now();
  let fields = {};
  let raw = null;
  let provider = null;
  let status = "EXTRACTED";
  let errorCode = null;

  try {
    const { buffer } = await vault.fetchBytes(client, row.vault_id);
    const vendor = await platformVendors.getConfig("gemini");
    const out = await vision.extract({
      image: buffer,
      mimeType: row.content_type || "application/pdf",
      prompt: `This is a ${kind.toLowerCase().replace(/_/g, " ")}. Extract exactly these fields: ` +
        `${PROMPTS[kind] || PROMPTS.SUPPLIER_INVOICE}. Omit any field you cannot read; do not guess`,
      vendor,
    });
    fields = out.fields || {};
    raw = out.raw || null;
    provider = out.provider || null;
  } catch (err) {
    // A FAILED row, not a thrown error and not a missing row. The reviewer
    // needs to see that we tried and could not — otherwise a scanned receipt
    // that our vision provider cannot read looks identical to one nobody has
    // got to yet, and it sits in the queue forever.
    logger.warn({ err, attachmentId }, "mail OCR extraction failed");
    status = "FAILED";
    errorCode = err.code || "EXTRACTION_FAILED";
  }

  const matches = status === "EXTRACTED" ? await findMatches(client, kind, fields) : [];

  // Confidence is derived from COVERAGE — how many of the fields we asked for
  // came back — not from anything the model reports about itself. A model's
  // self-assessed confidence is a number it generated, and treating it as
  // evidence about its own output is circular.
  const asked = (PROMPTS[kind] || "").split(",").filter(Boolean).length || 1;
  const got = Object.values(fields).filter((v) => v !== null && v !== undefined && v !== "").length;
  const confidence = status === "EXTRACTED" ? Math.min(1, got / asked) : 0;

  await governance.recordUsage(client, {
    userId: (user && user.user_id) || null,
    featureKey: FEATURE,
    provider,
    callType: `ocr.${kind.toLowerCase()}`,
    latencyMs: Date.now() - started,
    wasSuccessful: status === "EXTRACTED",
    errorCode,
  }).catch((err) => logger.error({ err }, "mail OCR: usage was NOT metered"));

  const { rows: saved } = await client.query(
    `INSERT INTO attachment_extraction
       (email_attachment_id, doc_kind, fields, raw, matches, confidence, provider, status)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8)
     RETURNING *`,
    [attachmentId, kind, JSON.stringify(fields), raw, JSON.stringify(matches),
      confidence.toFixed(3), provider, status],
  );

  await emitEvent(client, {
    eventTypeKey: "mail.ocr.extracted",
    moduleKey: MODULE,
    entityRef: `email_attachment:${attachmentId}`,
    actorUserId: (user && user.user_id) || null,
    payload: { doc_kind: kind, status, match_count: matches.length },
  }).catch(() => ({}));

  return saved[0];
}

/** What is waiting to be reviewed, newest first. */
/**
 * The pending queue — C-4.
 *
 * This listed every EXTRACTED row in the tenant, with the thread subject
 * attached, to any MOD-72 view user. It is a list of what has already been sent
 * to a third-party vision vendor, so an unscoped version discloses both the
 * documents and the conversations they came from.
 *
 * Now filtered by the same §9.5 predicate as every other list. `userId` is
 * required rather than defaulted: a caller that forgets it gets NOTHING rather
 * than everything, because the failure mode of this particular query is what
 * the finding was.
 */
async function listPending(client, { limit = 50, userId = null } = {}) {
  if (!userId) return [];
  const { rows } = await client.query(
    `SELECT e.*, a.filename, a.email_message_id, m.email_thread_id, m.subject
       FROM attachment_extraction e
       JOIN email_attachment a ON a.email_attachment_id = e.email_attachment_id
       JOIN email_message m ON m.email_message_id = a.email_message_id
       JOIN email_thread t ON t.email_thread_id = m.email_thread_id
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE e.status = 'EXTRACTED'
        AND t.email_connection_id IN ${threadRepo.accessible(2)}
        AND ${require("../triage/visibility").clause("$2")}
      ORDER BY e.created_at DESC
      LIMIT $1`,
    [limit, userId],
  );
  return rows;
}

/**
 * An extraction is addressed by its own id on review/dismiss, so the thread
 * predicate has to be reached through its attachment. Refuses with NOT_FOUND,
 * like every other visibility refusal in the module.
 */
async function assertExtractionVisible(client, extractionId, user) {
  const userId = (user && user.user_id) || null;
  const { rows } = await client.query(
    `SELECT e.attachment_extraction_id
       FROM attachment_extraction e
       JOIN email_attachment a ON a.email_attachment_id = e.email_attachment_id
       JOIN email_message m ON m.email_message_id = a.email_message_id
       JOIN email_thread t ON t.email_thread_id = m.email_thread_id
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE e.attachment_extraction_id = $1
        AND t.email_connection_id IN ${threadRepo.accessible(2)}
        AND ${require("../triage/visibility").clause("$2")}`,
    [extractionId, userId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "extraction not found", 404);
  return rows[0];
}

/** Everything extracted from one message's attachments — the reading pane strip. */
async function listForMessage(client, messageId) {
  const { rows } = await client.query(
    `SELECT e.*, a.filename
       FROM attachment_extraction e
       JOIN email_attachment a ON a.email_attachment_id = e.email_attachment_id
      WHERE a.email_message_id = $1
      ORDER BY e.created_at DESC`,
    [messageId],
  );
  return rows;
}

/**
 * Mark reviewed. The reviewer's CORRECTED fields are stored over the machine's,
 * because the point of a review is that the human's reading wins — a review
 * that keeps the model's version and merely notes that someone looked is a
 * rubber stamp with extra steps.
 *
 * Still writes nothing outside this table. The caller then opens the target
 * module's form with these fields prefilled, and the record is created there.
 */
async function review(client, extractionId, { fields = null } = {}, user = null) {
  await assertExtractionVisible(client, extractionId, user);
  const { rows } = await client.query(
    `UPDATE attachment_extraction
        SET status = 'REVIEWED',
            fields = COALESCE($2::jsonb, fields),
            reviewed_by = $3,
            reviewed_at = now()
      WHERE attachment_extraction_id = $1 AND status = 'EXTRACTED'
      RETURNING *`,
    [extractionId, fields ? JSON.stringify(fields) : null, (user && user.user_id) || null],
  );
  if (!rows[0]) throw new AppError("NOT_OPEN", "That extraction is not awaiting review.", 409);
  await audit(client, {
    actorUserId: (user && user.user_id) || null,
    action: "mail.ocr.reviewed",
    moduleKey: MODULE,
    entityRef: `attachment_extraction:${extractionId}`,
    after: rows[0],
  }).catch(() => ({}));
  return rows[0];
}

/** Dismiss: this is not a document we want staged. The row stays, so it is not
 *  re-extracted and so "how often is this wrong" remains answerable. */
async function dismiss(client, extractionId, user = null) {
  await assertExtractionVisible(client, extractionId, user);
  const { rows } = await client.query(
    `UPDATE attachment_extraction
        SET status = 'DISMISSED', reviewed_by = $2, reviewed_at = now()
      WHERE attachment_extraction_id = $1 AND status IN ('EXTRACTED','FAILED')
      RETURNING *`,
    [extractionId, (user && user.user_id) || null],
  );
  if (!rows[0]) throw new AppError("NOT_OPEN", "That extraction is not open.", 409);
  return rows[0];
}

module.exports = { extract, listPending, listForMessage, review, dismiss, guessKind, findMatches, KINDS, PROMPTS };
