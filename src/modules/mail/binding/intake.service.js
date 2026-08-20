/**
 * Inbound document intake (§7.6) — classify, propose, and file only when a
 * human says so.
 *
 * ── THE RULE, WHICH HAS NO EXCEPTIONS ───────────────────────────────────────
 *
 * §7.6, stated as a MUST: "never file silently, at any confidence, in this
 * programme." So this module writes exactly one kind of row unprompted — a
 * SUGGESTION in `email_attachment_classification` — and the only thing that
 * turns a suggestion into a filed document is `accept()`, which takes an actor.
 *
 * `document_requirement` and `email_attachment_classification` were created by
 * migration 10747 and read by nothing, so the attachment strip never offered
 * "Looks like a Bill of Lading for SLAS-2026-0042 — File it?" and the Documents
 * tab had no checklist to compute against.
 *
 * ── CLASSIFICATION IS FILENAME-AND-REQUIREMENT, NOT VISION ──────────────────
 *
 * Deliberately. §7.6 puts OCR in PR-4 behind `mail.ai`; the intake flow has to
 * work for a tenant with AI switched off, and for the large majority of real
 * attachments the filename plus the thread's binding already says it — a PDF
 * called `BL-SLAS-2026-0042.pdf` on a thread bound to that dossier is not a
 * hard problem. When PR-4's extractor lands it raises the confidence on the
 * same suggestion row rather than replacing this.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

const M = "MOD-72";

/**
 * Filename and subject patterns per document type, in the tenant's dictionary
 * codes. Ordered most-specific first: `CUSTOMS_DECLARATION` before `CUSTOMS`,
 * or every declaration matches the looser rule.
 */
const PATTERNS = [
  { code: "BL", re: /\b(b[\s._-]?l|bill[\s._-]?of[\s._-]?lading|connaissement)\b/i, confidence: 0.82 },
  { code: "MAWB", re: /\b(awb|mawb|air[\s._-]?way[\s._-]?bill|lta)\b/i, confidence: 0.82 },
  { code: "PACKING_LIST", re: /\b(packing[\s._-]?list|liste[\s._-]?de[\s._-]?colisage|colisage)\b/i, confidence: 0.80 },
  { code: "CUSTOMS", re: /\b(customs|douane|d[ée]claration|dedouanement|d[ée]douanement)\b/i, confidence: 0.72 },
  { code: "APEC", re: /\bapec\b/i, confidence: 0.85 },
  { code: "POD", re: /\b(pod|proof[\s._-]?of[\s._-]?delivery|bon[\s._-]?de[\s._-]?livraison)\b/i, confidence: 0.78 },
  { code: "RECEIPT", re: /\b(receipt|re[çc]u|quittance)\b/i, confidence: 0.70 },
  { code: "INVOICE", re: /\b(invoice|facture|inv[\s._-]?\d)/i, confidence: 0.75 },
  { code: "WAYBILL", re: /\b(waybill|lettre[\s._-]?de[\s._-]?voiture)\b/i, confidence: 0.75 },
];

/**
 * Underscores and dots are separators in a filename, and word characters to a
 * regex.
 *
 * `\bconnaissement\b` does not match `connaissement_maersk.pdf`, because `_`
 * is a word character and there is no boundary after it — which quietly meant
 * every real-world filename convention (`BL_SLAS_2026.pdf`,
 * `packing.list.xlsx`) classified as nothing. Normalising first is one line and
 * removes the whole class.
 */
const separators = (s) => String(s || "").replace(/[_.]+/g, " ");

/**
 * Classify one attachment.
 *
 * PURE. Filename first, then the thread subject at a discount — a subject
 * saying "invoice" while the attachment is called `scan001.pdf` is a weaker
 * signal than a filename that says so, and the confidence should show it.
 * Returns null rather than `OTHER` when nothing matches: `OTHER` is a decision,
 * and this function is not entitled to make one.
 */
function classify({ filename = "", subject = "" } = {}) {
  const name = separators(filename);
  for (const p of PATTERNS) {
    if (p.re.test(name)) {
      return { doc_type_code: p.code, confidence: p.confidence, matched_on: "filename" };
    }
  }
  for (const p of PATTERNS) {
    if (p.re.test(separators(subject))) {
      // Two thirds, rounded to three places like every other confidence in the
      // programme, so the UI can compare it against a binding suggestion.
      return { doc_type_code: p.code, confidence: Number((p.confidence * 0.66).toFixed(3)), matched_on: "subject" };
    }
  }
  return null;
}

/**
 * Propose a filing for every attachment on a message.
 *
 * Runs on ingest, after the attachments are in the vault. Writes suggestions
 * only. A message whose thread is bound to a client or dossier gets that as the
 * suggested destination; an unbound thread still gets a doc-type suggestion,
 * because "this is a Bill of Lading" is useful even before anyone has said
 * whose it is.
 */
async function suggestForMessage(client, { messageId, threadId, subject = null }) {
  const { rows: attachments } = await client.query(
    `SELECT a.email_attachment_id, a.filename, a.vault_id
       FROM email_attachment a
      WHERE a.email_message_id = $1
        AND NOT EXISTS (SELECT 1 FROM email_attachment_classification k
                         WHERE k.email_attachment_id = a.email_attachment_id)`,
    [messageId],
  ).catch(() => ({ rows: [] }));
  if (!attachments.length) return { suggested: 0 };

  const entityRef = threadId
    ? await client.query(
      `SELECT entity_ref FROM email_thread WHERE email_thread_id = $1`, [threadId],
    ).then((r) => (r.rows[0] || {}).entity_ref || null).catch(() => null)
    : null;

  let suggested = 0;
  for (const a of attachments) {
    const guess = classify({ filename: a.filename, subject });
    if (!guess) continue;
    await client.query(
      `INSERT INTO email_attachment_classification
         (email_attachment_id, suggested_doc_type_code, suggested_entity_ref, confidence, status)
       VALUES ($1,$2,$3,$4,'SUGGESTED')`,
      [a.email_attachment_id, guess.doc_type_code, entityRef, guess.confidence],
    ).catch((err) => logger.debug({ err }, "[mail] classification not stored"));
    suggested += 1;
  }
  return { suggested };
}

/** The suggestions on a thread, for the attachment strip. */
const listForThread = (client, threadId) =>
  client.query(
    `SELECT k.*, a.filename, a.vault_id, a.email_message_id,
            d.name_en, d.name_fr
       FROM email_attachment_classification k
       JOIN email_attachment a ON a.email_attachment_id = k.email_attachment_id
       JOIN email_message m ON m.email_message_id = a.email_message_id
       LEFT JOIN dictionary_ref d
              ON d.kind = 'DOCUMENT_TYPE' AND d.code = k.suggested_doc_type_code
      WHERE m.email_thread_id = $1 AND k.status = 'SUGGESTED'
      ORDER BY k.confidence DESC`,
    [threadId],
  ).then((r) => r.rows).catch(() => []);

/**
 * File it — the ONLY path from a suggestion to a document.
 *
 * §7.6's flow ends "we set `document_vault.doc_type_ref_id` + `client_id`, emit
 * `document.captured`, and it appears in Client 360 → Documents". All three
 * happen here and nowhere else.
 *
 * The user's corrections win over the suggestion: `docTypeCode` and `entityRef`
 * are what the human confirmed, not what was proposed. That is the whole point
 * of the confirm step, and silently preferring the machine's guess would make
 * the dialog decorative.
 */
async function accept(client, classificationId, { docTypeCode = null, entityRef = null } = {}, actor = {}) {
  const { rows } = await client.query(
    `SELECT k.*, a.vault_id
       FROM email_attachment_classification k
       JOIN email_attachment a ON a.email_attachment_id = k.email_attachment_id
      WHERE k.email_attachment_classification_id = $1`,
    [classificationId],
  );
  const k = rows[0];
  if (!k) throw new AppError("NOT_FOUND", "suggestion not found", 404);
  if (k.status !== "SUGGESTED") throw new AppError("ALREADY_DECIDED", "This attachment has already been dealt with.", 409);

  const code = docTypeCode || k.suggested_doc_type_code;
  const ref = entityRef || k.suggested_entity_ref;
  if (!code) throw new AppError("VALIDATION_ERROR", "a document type is required to file this", 422);

  const typeRow = await client.query(
    `SELECT ref_id FROM dictionary_ref WHERE kind = 'DOCUMENT_TYPE' AND code = $1 AND is_active`,
    [code],
  ).then((r) => r.rows[0] || null);
  if (!typeRow) throw new AppError("VALIDATION_ERROR", `"${code}" is not a document type in this tenant.`, 422);

  const clientId = /^client:(.+)$/.test(String(ref || "")) ? String(ref).slice("client:".length) : null;

  await client.query(
    `UPDATE document_vault
        SET doc_type_ref_id = $2,
            client_id = COALESCE($3, client_id)
      WHERE doc_id = $1`,
    [k.vault_id, typeRow.ref_id, clientId],
  );

  const { rows: done } = await client.query(
    `UPDATE email_attachment_classification
        SET status = 'FILED', filed_doc_id = $2, decided_by = $3, decided_at = now(),
            suggested_doc_type_code = $4, suggested_entity_ref = COALESCE($5, suggested_entity_ref)
      WHERE email_attachment_classification_id = $1
      RETURNING *`,
    [classificationId, k.vault_id, actor.user_id || null, code, ref],
  );

  // What puts it in Client 360 → Documents.
  await emitEvent(client, {
    eventTypeKey: "document.captured", moduleKey: M,
    entityRef: ref || `document_vault:${k.vault_id}`,
    actorUserId: actor.user_id || null,
    payload: { doc_id: k.vault_id, doc_type_code: code, from: "MAIL" },
  }).catch(() => { /* @silent:storage the vault row is the outcome */ });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.document.filed",
    moduleKey: M, entityRef: ref || `document_vault:${k.vault_id}`,
    after: { doc_id: k.vault_id, doc_type_code: code },
  }).catch(() => { /* @silent:storage */ });

  return done[0];
}

/** Not this, thanks. Keeps the row so the same file is not re-proposed forever. */
const reject = (client, classificationId, actor = {}) =>
  client.query(
    `UPDATE email_attachment_classification
        SET status = 'REJECTED', decided_by = $2, decided_at = now()
      WHERE email_attachment_classification_id = $1 AND status = 'SUGGESTED'
      RETURNING *`,
    [classificationId, actor.user_id || null],
  ).then((r) => {
    if (!r.rows[0]) throw new AppError("NOT_FOUND", "suggestion not found", 404);
    return r.rows[0];
  });

/* ── The chase composer (§7.6) ────────────────────────────────────────────── */

/**
 * What is still outstanding for a client, in both languages.
 *
 * §7.6: the composer opens prefilled with "a bilingual list of exactly the
 * outstanding items, in the client's preferred_language, from a tenant-editable
 * snippet". "Exactly" is the operative word — a chase listing documents the
 * client already sent is worse than no chase, because it tells them nobody
 * looked.
 */
async function chaseList(client, clientId) {
  const { rows } = await client.query(
    `SELECT r.doc_type_code, r.is_mandatory, d.name_en, d.name_fr
       FROM document_requirement r
       LEFT JOIN dictionary_ref d
              ON d.kind = 'DOCUMENT_TYPE' AND d.code = r.doc_type_code
      WHERE r.is_active AND r.applies_to = 'CLIENT'
        AND NOT EXISTS (
          SELECT 1 FROM document_vault v
           WHERE v.client_id = $1 AND v.doc_type_ref_id = d.ref_id AND v.status <> 'ARCHIVED'
        )
      ORDER BY r.is_mandatory DESC, r.sort_order`,
    [clientId],
  ).catch(() => ({ rows: [] }));

  const language = await client.query(
    `SELECT preferred_language FROM client_master WHERE client_id = $1`, [clientId],
  ).then((r) => (r.rows[0] || {}).preferred_language || null).catch(() => null);

  return {
    client_id: clientId,
    language,
    missing: rows,
    // Nothing outstanding is a real answer, and the UI must say so rather than
    // opening an empty chase.
    nothing_outstanding: rows.length === 0,
  };
}

module.exports = {
  PATTERNS, classify, suggestForMessage, listForThread, accept, reject, chaseList,
};
