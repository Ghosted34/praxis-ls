/**
 * Budget Reconciliation repository (MOD-76).
 *
 * ── THE ONE IDEA ────────────────────────────────────────────────────────────
 *
 * `gridFor` reads from `costing_line`, not from `dossier_reconciliation_line`.
 *
 * That is the whole module. The legacy copied the costing's lines into
 * `ocr_line` at draft time and so did this module's previous `buildLines`; a
 * copy is a decision to go stale, and rebuilding it destroys whatever a human
 * typed (which is why the old `deleteLines` could only be called on a DRAFT).
 * Projecting instead means an amended costing IS an amended reconciliation:
 * a new budget line appears here on the next read, on a sheet settled last
 * month, with every other line's typed values untouched. Owner decision Q6.
 *
 * So this table is SPARSE. A costing line nobody has touched has no row and
 * still renders. A row appears the moment someone types into it, and holds only
 * what they typed: the actual, the date it was spent, the reason for an
 * overrun, the cash returned.
 */
"use strict";

const costingRepo = require("../costing/costing.repo");

/**
 * HT already posted to THIS budget line — Σ cost_entry.amount (which is HT)
 * where costing_line_id matches. Used by settle() for the delta posting (guide
 * §4.4 step 2): post (actual_ttc − already_posted_ttc converted to HT) rather
 * than re-posting the gross, and read it back so a re-settle after re-open
 * posts only the delta since last time (the re-open safeguard, PR 2).
 */
async function postedTotalsByLine(client, { reconciliationId, dossierId }) {
  const { rows } = await client.query(
    `SELECT ce.costing_line_id,
            COALESCE(SUM(ce.amount), 0) AS posted_ht
       FROM cost_entry ce
      WHERE ce.dossier_id = $1 AND ce.costing_line_id IS NOT NULL
      GROUP BY ce.costing_line_id`,
    [dossierId],
  );
  const map = new Map();
  for (const r of rows) map.set(r.costing_line_id, Number(r.posted_ht));
  return map;
}

/**
 * Funding régie advances against this dossier — the advances that settlement
 * must retire (guide §4.4 step 3, §7.2). A DISBURSED funding request has
 * regie_advance_id set; overhead advances (dossier_id NULL) are excluded so we
 * never retire a holder's personal float against an operations file.
 *
 * Returned with their current justified_amount / returned_amount so settlement
 * can post the DELTA only (owner safeguard 1): if a holder already handed cash
 * back at the window we must not retire it a second time.
 */
async function fundingAdvancesForDossier(client, { dossierId }) {
  const { rows } = await client.query(
    `SELECT ra.regie_advance_id, ra.entity_id, ra.amount, ra.justified_amount, ra.returned_amount,
            ra.state, ra.holder_user_id, ra.issued_on,
            cr.cash_request_id, cr.doc_number AS cash_request_ref
       FROM regie_advance ra
       JOIN cash_request cr ON cr.regie_advance_id = ra.regie_advance_id
      WHERE cr.dossier_id = $1
        AND cr.status IN ('DISBURSED','PARTIALLY_DISBURSED')
      ORDER BY ra.issued_on, ra.regie_advance_id`,
    [dossierId],
  );
  return rows;
}

/**
 * DISBURSED cash requests for this dossier. After the régie retirements in
 * settle(), any whose open balance is now zero (all lines accounted for) flip
 * to JUSTIFIED (guide §4.4 step 5).
 */
async function disbursedCashRequests(client, { dossierId }) {
  const { rows } = await client.query(
    `SELECT cr.cash_request_id, cr.regie_advance_id, cr.doc_number, cr.status
       FROM cash_request cr
      WHERE cr.dossier_id = $1
        AND cr.status IN ('DISBURSED','PARTIALLY_DISBURSED')`,
    [dossierId],
  );
  return rows;
}

/** Dossier's entity_id, required for journal entry posting (analytic). */
async function dossierEntityId(client, { dossierId }) {
  const { rows } = await client.query(
    "SELECT entity_id FROM dossier WHERE dossier_id = $1",
    [dossierId],
  );
  return rows[0] ? rows[0].entity_id : null;
}

/** Earliest line spent_on across the current grid — used to decide the
 *  entryDate for régie RECEIPT retirements that cover the whole file (the
 *  accounting date is the date the money left the holder's hands). */
async function earliestSpentOn(client, { dossierId, reconciliationId }) {
  const { rows } = await client.query(
    `SELECT MIN(rl.spent_on) AS earliest
       FROM dossier_reconciliation_line rl
      WHERE rl.reconciliation_id = $2
        AND rl.spent_on IS NOT NULL`,
    [dossierId, reconciliationId],
  );
  return rows[0] && rows[0].earliest ? rows[0].earliest : null;
}

/* ═══════════════════════════ The header ══════════════════════════════════ */

async function get(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM dossier_reconciliation WHERE reconciliation_id = $1",
    [id],
  );
  return rows[0] || null;
}

async function forDossier(client, dossierId) {
  const { rows } = await client.query(
    "SELECT * FROM dossier_reconciliation WHERE dossier_id = $1",
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * Open the file's reconciliation, or return the one that is already there.
 *
 * ON CONFLICT DO NOTHING against `uq_reconciliation_one_per_dossier` (13801),
 * so two people opening the same file at the same moment get the same row
 * rather than one of them getting a 23505. One per file, for ever (Q6) — this
 * is the only place a reconciliation is ever created.
 */
async function open(client, { dossierId, actorUserId, currency, rate }) {
  const { rows } = await client.query(
    `INSERT INTO dossier_reconciliation (dossier_id, created_by, currency, exchange_rate_to_xaf, status)
     VALUES ($1, $2, COALESCE($3, 'XAF'), COALESCE($4, 1), 'OPEN')
     ON CONFLICT (dossier_id) DO NOTHING
     RETURNING *`,
    [dossierId, actorUserId, currency, rate],
  );
  // DO NOTHING returns no row when somebody else won the race, so the SELECT is
  // the answer in exactly that case — and is never skipped on the strength of
  // an INSERT that may legitimately have written nothing.
  return rows[0] || forDossier(client, dossierId);
}

async function setStatus(client, id, { sql, params = [] }) {
  const { rows } = await client.query(
    `UPDATE dossier_reconciliation SET ${sql} WHERE reconciliation_id = $1 RETURNING *`,
    [id, ...params],
  );
  return rows[0] || null;
}

/* ═══════════════════════════ The grid ════════════════════════════════════ */

/**
 * Every budget line on the file's approved costing, with what has been claimed
 * against it, what has been paid, whatever a human has entered, and what the
 * ledger already knows.
 *
 * `LINE_VAT_SQL` and `claimsLateral` come from `costing.repo` rather than being
 * written again here: the budget bar the cash request draws against and the
 * budget column on this sheet have to be the same number, and the only way to
 * guarantee that is one definition. See `claimsLateral`'s header.
 *
 * `justification_required` is its own small LATERAL because the CASH REQUEST is
 * SSOT for the tick (Q9): the catalogue seeds the default, a validator may tick
 * it upward, and re-deriving it from `dictionary_item` here would silently throw
 * that decision away. `bool_or` because if ANY live claim against this budget
 * line was ticked, the line owes a receipt.
 *
 * `posted_ht` / `posted_ttc` (13802, PR 2). Now that settlement writes
 * `cost_entry.costing_line_id`, a join is meaningful. Posted is HT on the
 * ledger (cost_entry.amount is HT); we expose `posted_ttc` too, grossed up by
 * the line's own VAT ratio, so the pre-fill rule (Q2 = C) can put the TTC
 * number in front of a person without mixing the two bases in one column. The
 * pre-fill is `COALESCE(posted_ttc, disbursed)` — once postings exist the
 * ledger knows, not the cash request.
 */
async function gridFor(client, { dossierId, reconciliationId }) {
  const claims = costingRepo.claimsLateral({ committing: "$3", pending: "$4" });
  const vat = costingRepo.LINE_VAT_SQL;
  const { rows } = await client.query(
    `SELECT cl.costing_line_id, cl.line_no, cl.label, cl.dictionary_item_id,
            cl.is_disbursement, cl.qty, cl.unit_cost,
            di.code                              AS item_code,
            COALESCE(di.label_en, di.label_fr)   AS item_label,
            dr.code                              AS container_type_code,
            ROUND(cl.qty * cl.unit_cost, 2)               AS net,
            ROUND(${vat}, 2)                              AS vat,
            ROUND(cl.qty * cl.unit_cost + ${vat}, 2)      AS budget_ttc,
            claims.committed, claims.pending, claims.disbursed,
            COALESCE(post.posted_ht, 0)                   AS posted_ht,
            COALESCE(post.posted_ttc, 0)                  AS posted_ttc,
            COALESCE(just.justification_required, false)  AS justification_required,
            rl.line_id, rl.actual_ttc, rl.actual_source, rl.spent_on,
            rl.variance_reason, rl.reason_group_id, rl.returned_amount,
            rl.updated_at, rl.updated_by,
            COALESCE(docs.document_count, 0)              AS document_count
       FROM costing_line cl
       JOIN costing c            ON c.costing_id = cl.costing_id
       LEFT JOIN tax_code tc     ON tc.tax_code_id = cl.tax_code_id
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = cl.dictionary_item_id
       LEFT JOIN dictionary_ref dr  ON dr.ref_id = cl.container_type_ref_id
       ${claims}
       LEFT JOIN LATERAL (
         SELECT bool_or(crl.justification_required) AS justification_required
           FROM cash_request_line crl
           JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
          WHERE crl.costing_line_id = cl.costing_line_id
            AND cr.status <> 'REJECTED'
       ) just ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ce.amount), 0) AS posted_ht,
                -- Gross HT back to TTC at the line's own VAT ratio. débours carry
                -- their upstream_vat_amount explicitly rather than a percent, so
                -- the ratio uses net + vat (the budget denominator) which works
                -- for both shapes. If net + vat is zero (a zero line) we read HT
                -- as TTC — there is no cash to mis-state.
                ROUND(COALESCE(SUM(ce.amount), 0)
                      * CASE WHEN (cl.qty * cl.unit_cost + ${vat}) > 0
                             THEN (cl.qty * cl.unit_cost + ${vat}) / NULLIF(cl.qty * cl.unit_cost, 0)
                             ELSE 1 END, 2) AS posted_ttc
           FROM cost_entry ce
          WHERE ce.costing_line_id = cl.costing_line_id
            AND ce.dossier_id = c.dossier_id
       ) post ON TRUE
       LEFT JOIN dossier_reconciliation_line rl
              ON rl.reconciliation_id = $2 AND rl.costing_line_id = cl.costing_line_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS document_count
           FROM dossier_reconciliation_document d
          WHERE d.line_id = rl.line_id
       ) docs ON TRUE
      WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'
      ORDER BY cl.line_no, cl.costing_line_id`,
    [dossierId, reconciliationId, costingRepo.COMMITTING_STATUSES, costingRepo.PENDING_STATUSES],
  );
  return rows;
}

/** The file's approved costing, for the header and for the "no costing yet"
 *  empty state. One live costing per dossier (uq_costing_one_live_per_dossier). */
async function approvedCosting(client, dossierId) {
  const { rows } = await client.query(
    `SELECT costing_id, doc_number, status, currency, exchange_rate_to_xaf
       FROM costing
      WHERE dossier_id = $1
      ORDER BY CASE WHEN status = 'APPROVED_LOCKED' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
    [dossierId],
  );
  return rows[0] || null;
}

/* ═══════════════════════ The sparse line ═════════════════════════════════ */

/**
 * Write what a person entered against one budget line.
 *
 * UPSERT on `uq_recon_line_costing_line`, which is what makes the sparse model
 * work: the first edit creates the row, every later edit updates it, and the
 * caller never has to know which it was.
 *
 * `COALESCE(EXCLUDED.x, rl.x)` on every field so a PATCH carrying one key does
 * not blank the others — a payload that omits a field is not a payload that
 * clears it. Passing an explicit null is how you clear one (see the service,
 * which distinguishes "absent" from "null" before it gets here).
 */
async function upsertLine(client, { reconciliationId, costingLineId, fields, actorUserId }) {
  const { rows } = await client.query(
    `INSERT INTO dossier_reconciliation_line
       (reconciliation_id, costing_line_id, actual_ttc, actual_source, spent_on,
        variance_reason, reason_group_id, returned_amount, updated_by, updated_at)
     VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, 'DERIVED'), $5, $6, $7, COALESCE($8, 0), $9, now())
     ON CONFLICT (reconciliation_id, costing_line_id) DO UPDATE SET
       actual_ttc      = COALESCE($3, dossier_reconciliation_line.actual_ttc),
       actual_source   = COALESCE($4, dossier_reconciliation_line.actual_source),
       spent_on        = COALESCE($5, dossier_reconciliation_line.spent_on),
       variance_reason = COALESCE($6, dossier_reconciliation_line.variance_reason),
       reason_group_id = COALESCE($7, dossier_reconciliation_line.reason_group_id),
       returned_amount = COALESCE($8, dossier_reconciliation_line.returned_amount),
       updated_by      = $9,
       updated_at      = now()
     RETURNING *`,
    [
      reconciliationId, costingLineId,
      fields.actual_ttc, fields.actual_source, fields.spent_on,
      fields.variance_reason, fields.reason_group_id, fields.returned_amount,
      actorUserId,
    ],
  );
  return rows[0];
}

/** Clear a field the caller explicitly nulled. Separate from `upsertLine`
 *  because COALESCE cannot express "set this to null" — the two operations look
 *  the same to SQL and mean opposite things to a user. */
async function clearLineFields(client, { reconciliationId, costingLineId, fields = [] }) {
  if (!fields.length) return null;
  const sets = fields.map((f) => `${f} = NULL`).join(", ");
  const { rows } = await client.query(
    `UPDATE dossier_reconciliation_line SET ${sets}, updated_at = now()
      WHERE reconciliation_id = $1 AND costing_line_id = $2 RETURNING *`,
    [reconciliationId, costingLineId],
  );
  return rows[0] || null;
}

async function lineFor(client, { reconciliationId, costingLineId }) {
  const { rows } = await client.query(
    `SELECT * FROM dossier_reconciliation_line
      WHERE reconciliation_id = $1 AND costing_line_id = $2`,
    [reconciliationId, costingLineId],
  );
  return rows[0] || null;
}

/** Does this budget line belong to this file's approved costing? The API takes
 *  a `costing_line_id` from the caller, so this is the authorisation check that
 *  stops one file's sheet writing onto another file's budget line. */
async function costingLineOnDossier(client, { dossierId, costingLineId }) {
  const { rows } = await client.query(
    `SELECT cl.costing_line_id
       FROM costing_line cl
       JOIN costing c ON c.costing_id = cl.costing_id
      WHERE cl.costing_line_id = $2 AND c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'`,
    [dossierId, costingLineId],
  );
  return !!rows[0];
}

/** Apply one reason to several budget lines at once (Q12). Upserts each, so a
 *  line with no row yet gets one. */
async function applyReasonToLines(client, { reconciliationId, costingLineIds, reason, groupId, actorUserId }) {
  const { rows } = await client.query(
    `INSERT INTO dossier_reconciliation_line
       (reconciliation_id, costing_line_id, variance_reason, reason_group_id, updated_by, updated_at)
     SELECT $1, id, $3, $4, $5, now() FROM unnest($2::uuid[]) AS id
     ON CONFLICT (reconciliation_id, costing_line_id) DO UPDATE SET
       variance_reason = $3, reason_group_id = $4, updated_by = $5, updated_at = now()
     RETURNING *`,
    [reconciliationId, costingLineIds, reason, groupId, actorUserId],
  );
  return rows;
}

/* ═════════════════════════ Documents ═════════════════════════════════════ */

/**
 * Many per line, deliberately (Q8) — the first Maersk demurrage invoice covers
 * one day, the second covers two, and both belong. ON CONFLICT DO NOTHING so
 * attaching the same document twice is a no-op rather than a 23505.
 */
async function attachDocument(client, { lineId, docId, note, actorUserId }) {
  const { rows } = await client.query(
    `INSERT INTO dossier_reconciliation_document (line_id, doc_id, note, uploaded_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (line_id, doc_id) DO NOTHING
     RETURNING *`,
    [lineId, docId, note || null, actorUserId],
  );
  return rows[0] || null;
}

/** Detach only. The vault row is left alone: a document is evidence, and
 *  removing it from one line is not a decision to destroy it. */
async function detachDocument(client, { lineId, docId }) {
  const { rowCount } = await client.query(
    "DELETE FROM dossier_reconciliation_document WHERE line_id = $1 AND doc_id = $2",
    [lineId, docId],
  );
  return rowCount > 0;
}

async function documentsFor(client, reconciliationId) {
  const { rows } = await client.query(
    `SELECT d.recon_document_id, d.line_id, d.doc_id, d.note, d.uploaded_by, d.uploaded_at,
            rl.costing_line_id,
            v.doc_type, v.storage_path, v.status AS doc_status, v.content_hash,
            u.full_name AS uploaded_by_name
       FROM dossier_reconciliation_document d
       JOIN dossier_reconciliation_line rl ON rl.line_id = d.line_id
       JOIN document_vault v ON v.doc_id = d.doc_id
       LEFT JOIN app_user u ON u.user_id = d.uploaded_by
      WHERE rl.reconciliation_id = $1
      ORDER BY d.uploaded_at`,
    [reconciliationId],
  );
  return rows;
}

/* ═════════════════════ Settlement history ════════════════════════════════ */

async function insertSettlement(client, s) {
  const { rows } = await client.query(
    `INSERT INTO dossier_reconciliation_settlement
       (reconciliation_id, revision, budget_ttc, disbursed_ttc, actual_ttc, returned_ttc, settled_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (reconciliation_id, revision) DO NOTHING
     RETURNING *`,
    [s.reconciliation_id, s.revision, s.budget_ttc, s.disbursed_ttc, s.actual_ttc, s.returned_ttc, s.settled_by],
  );
  return rows[0] || null;
}

async function settlements(client, reconciliationId) {
  const { rows } = await client.query(
    `SELECT * FROM dossier_reconciliation_settlement
      WHERE reconciliation_id = $1 ORDER BY revision DESC`,
    [reconciliationId],
  );
  return rows;
}

/** Write the agreed actual back onto the ops file — the stamp that says this
 *  file has been accounted for. Same columns the legacy's `ocr_*` write-back
 *  used and the previous implementation wrote. */
async function stampDossier(client, { dossierId, reconciliationId, amount, status }) {
  await client.query(
    `UPDATE dossier
        SET ocr_reconciliation_id = $2, ocr_amount = $3, ocr_status = $4
      WHERE dossier_id = $1`,
    [dossierId, reconciliationId, amount, status],
  );
}

/* ═══════════════════ What a person still owes (Q10) ══════════════════════ */

/**
 * Receipts owed, by the person who took the cash.
 *
 * The receiver is `cash_request_payment.received_by` — the régie holder who
 * physically took the tranche (12771 §3), which is who the obligation belongs
 * to. A line owes a receipt when a live claim against it was ticked
 * `justification_required`, cash actually moved, and no document has been
 * attached to its reconciliation line yet.
 *
 * `userId` null means everyone, for Finance's view.
 */
async function receiptsOwed(client, { userId = null } = {}) {
  const { rows } = await client.query(
    `SELECT DISTINCT
            d.dossier_id, d.ref AS dossier_ref,
            cl.costing_line_id, cl.label AS line_label,
            p.received_by AS owed_by,
            u.full_name    AS owed_by_name,
            r.reconciliation_id,
            ROUND(crl.budget_amount * (1 + COALESCE(crl.vat_percent, 0) / 100), 2) AS claimed_ttc
       FROM cash_request_line crl
       JOIN cash_request cr        ON cr.cash_request_id = crl.cash_request_id
       JOIN cash_request_payment p ON p.cash_request_id = cr.cash_request_id
       JOIN costing_line cl        ON cl.costing_line_id = crl.costing_line_id
       JOIN costing c              ON c.costing_id = cl.costing_id
       -- dossier_visible, not dossier: this ENUMERATES across files, and a DRAFT
       -- is half-finished wizard state rather than a file somebody owes a
       -- receipt on (0671). Backtick-free on purpose: this is inside a JS
       -- template literal.
       JOIN dossier_visible d      ON d.dossier_id = c.dossier_id
       LEFT JOIN app_user u        ON u.user_id = p.received_by
       LEFT JOIN dossier_reconciliation r ON r.dossier_id = c.dossier_id
       LEFT JOIN dossier_reconciliation_line rl
              ON rl.reconciliation_id = r.reconciliation_id
             AND rl.costing_line_id = cl.costing_line_id
      WHERE crl.justification_required = true
        AND cr.status <> 'REJECTED'
        AND p.received_by IS NOT NULL
        AND ($1::uuid IS NULL OR p.received_by = $1::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM dossier_reconciliation_document dd WHERE dd.line_id = rl.line_id
        )
      ORDER BY d.ref, cl.label`,
    [userId],
  );
  return rows;
}

module.exports = {
  get, forDossier, open, setStatus,
  gridFor, approvedCosting,
  upsertLine, clearLineFields, lineFor, costingLineOnDossier, applyReasonToLines,
  attachDocument, detachDocument, documentsFor,
  insertSettlement, settlements, stampDossier,
  receiptsOwed,
  postedTotalsByLine, fundingAdvancesForDossier, disbursedCashRequests,
  dossierEntityId, earliestSpentOn,
};
