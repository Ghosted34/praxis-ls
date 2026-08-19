/** OCR repository (G19) — dossier_reconciliation + lines + write-back. */
"use strict";

async function get(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM dossier_reconciliation WHERE reconciliation_id = $1",
    [id],
  );
  return rows[0] || null;
}

async function openForDossier(client, dossierId) {
  const { rows } = await client.query(
    `SELECT * FROM dossier_reconciliation
      WHERE dossier_id = $1 AND status IN ('DRAFT','SUBMITTED')
      ORDER BY created_at DESC LIMIT 1`,
    [dossierId],
  );
  return rows[0] || null;
}

async function latestForDossier(client, dossierId) {
  const { rows } = await client.query(
    `SELECT * FROM dossier_reconciliation
      WHERE dossier_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [dossierId],
  );
  return rows[0] || null;
}

async function insert(client, { dossierId, actorUserId }) {
  const { rows } = await client.query(
    `INSERT INTO dossier_reconciliation (dossier_id, created_by)
     VALUES ($1, $2) RETURNING *`,
    [dossierId, actorUserId],
  );
  return rows[0];
}

async function insertLines(client, reconciliationId, lines) {
  for (const l of lines) {
    await client.query(
      `INSERT INTO dossier_reconciliation_line
         (reconciliation_id, dictionary_item_id, item_code, item_label, budget_ht, actual_ht, is_disbursement, doc_ref, doc_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [reconciliationId, l.dictionary_item_id || null, l.item_code || null, l.item_label || null,
        l.budget_ht || 0, l.actual_ht || 0, l.is_disbursement === true, l.doc_ref || null, l.doc_required === true],
    );
  }
}

async function lines(client, reconciliationId) {
  const { rows } = await client.query(
    "SELECT * FROM dossier_reconciliation_line WHERE reconciliation_id = $1 ORDER BY item_code, line_id",
    [reconciliationId],
  );
  return rows;
}

async function setStatus(client, id, fields) {
  const { rows } = await client.query(
    `UPDATE dossier_reconciliation SET ${fields.sql} WHERE reconciliation_id = $1 RETURNING *`,
    [id, ...fields.params],
  );
  return rows[0] || null;
}

/** The per-item budget (approved costing lines) and actual (cost entries),
 *  SERVICE COSTS ONLY. HT throughout (BUG-2).
 *
 *  Débours (pass-through) are excluded from both sides (BUG-3, OHADA_KB
 *  §6.7/§450): they are neither revenue nor cost to the forwarder, so a file
 *  heavy in customs/port débours must not move the service-cost variance. The
 *  budget uses costing_line.is_disbursement directly (the flag set at costing
 *  time); actuals join dictionary_item, because cost_entry carries no flag of
 *  its own and the ledger's assert_line_valid() enforces the same item flag. A
 *  cost entry with no dictionary item is an own-cost, never a débours.
 *
 *  Débours are reported separately by disbursementTotals(). */
async function costCompare(client, dossierId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(b.dictionary_item_id, a.dictionary_item_id) AS dictionary_item_id,
       COALESCE(di.code, 'OTHER') AS item_code,
       -- label_en/label_fr: dictionary_item has never had a name_* pair (0200),
       -- and every other read of the billing dictionary uses the label_ names.
       COALESCE(di.label_en, di.label_fr, 'Other') AS item_label,
       COALESCE(b.budget_ht, 0) AS budget_ht,
       COALESCE(a.actual_ht, 0) AS actual_ht
     FROM
       (SELECT cl.dictionary_item_id, SUM(cl.qty * cl.unit_cost) AS budget_ht
          FROM costing_line cl
          JOIN costing c ON c.costing_id = cl.costing_id
         -- costing_status_check (10718:74) permits DRAFT, SUBMITTED_FOR_*,
         -- APPROVED_LOCKED, UNLOCK_REQUESTED, REJECTED. There is no 'APPROVED'
         -- or 'LOCKED' status — the old IN (...) matched nothing, so every
         -- reconciliation silently reported a zero budget. Match the single
         -- locked/approved state; this agrees with cost_tracking.repo.js.
         WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'
           AND COALESCE(cl.is_disbursement, false) = false
         GROUP BY cl.dictionary_item_id) b
       FULL OUTER JOIN
       (SELECT ce.dictionary_item_id, SUM(ce.amount) AS actual_ht
          FROM cost_entry ce
          LEFT JOIN dictionary_item d2 ON d2.dictionary_item_id = ce.dictionary_item_id
         WHERE ce.dossier_id = $1 AND COALESCE(d2.is_disbursement, false) = false
         GROUP BY ce.dictionary_item_id) a
         ON a.dictionary_item_id = b.dictionary_item_id
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = COALESCE(b.dictionary_item_id, a.dictionary_item_id)
     ORDER BY item_code`,
    [dossierId],
  );
  return rows;
}

/** Débours for a dossier: what was budgeted on the approved costing vs what was
 *  actually posted. Pass-through — excluded from the service-cost variance and
 *  margin above, but a real operational total the reconciler accounts for
 *  separately (BUG-3). The budget uses the costing line flag; actuals join
 *  dictionary_item because cost_entry has no flag of its own. */
async function disbursementTotals(client, dossierId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(cl.qty * cl.unit_cost)
                   FROM costing_line cl JOIN costing c ON c.costing_id = cl.costing_id
                  WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'
                    AND COALESCE(cl.is_disbursement, false) = true), 0) AS budget_ht,
       COALESCE((SELECT SUM(ce.amount)
                   FROM cost_entry ce JOIN dictionary_item di ON di.dictionary_item_id = ce.dictionary_item_id
                  WHERE ce.dossier_id = $1 AND di.is_disbursement = true), 0) AS actual_ht`,
    [dossierId],
  );
  return { budget_ht: Number(rows[0].budget_ht), actual_ht: Number(rows[0].actual_ht) };
}

/** Whether a proof document is required for an item (dictionary rule). */
async function itemRequiresDoc(client, dictionaryItemId) {
  if (!dictionaryItemId) return false;
  const { rows } = await client.query(
    "SELECT receipt_requirement FROM dictionary_item WHERE dictionary_item_id = $1",
    [dictionaryItemId],
  );
  return rows[0] ? rows[0].receipt_requirement === "ALWAYS_REQUIRED" : false;
}

/** Write the validated amount + status back onto the ops file (legacy ocr_*). */
async function stampDossier(client, { dossierId, reconciliationId, amount }) {
  await client.query(
    `UPDATE dossier
        SET ocr_reconciliation_id = $2, ocr_amount = $3, ocr_status = 'VALIDATED'
      WHERE dossier_id = $1`,
    [dossierId, reconciliationId, amount],
  );
}

module.exports = {
  get, openForDossier, latestForDossier, insert, insertLines, lines, setStatus,
  costCompare, disbursementTotals, itemRequiresDoc, stampDossier,
};
