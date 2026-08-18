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
         (reconciliation_id, dictionary_item_id, item_code, item_label, budget_ttc, actual_ttc, doc_ref, doc_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [reconciliationId, l.dictionary_item_id || null, l.item_code || null, l.item_label || null,
        l.budget_ttc || 0, l.actual_ttc || 0, l.doc_ref || null, l.doc_required === true],
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

/** The per-item budget (approved costing lines) and actual (cost entries). */
async function costCompare(client, dossierId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(b.dictionary_item_id, a.dictionary_item_id) AS dictionary_item_id,
       COALESCE(di.code, 'OTHER') AS item_code,
       COALESCE(di.name_en, di.name_fr, 'Other') AS item_label,
       COALESCE(b.budget_ttc, 0) AS budget_ttc,
       COALESCE(a.actual_ttc, 0) AS actual_ttc
     FROM
       (SELECT cl.dictionary_item_id, SUM(cl.qty * cl.unit_cost) AS budget_ttc
          FROM costing_line cl
          JOIN costing c ON c.costing_id = cl.costing_id
         WHERE c.dossier_id = $1 AND c.status IN ('APPROVED','LOCKED')
         GROUP BY cl.dictionary_item_id) b
       FULL OUTER JOIN
       (SELECT dictionary_item_id, SUM(amount) AS actual_ttc
          FROM cost_entry WHERE dossier_id = $1
          GROUP BY dictionary_item_id) a
         ON a.dictionary_item_id = b.dictionary_item_id
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = COALESCE(b.dictionary_item_id, a.dictionary_item_id)
     ORDER BY item_code`,
    [dossierId],
  );
  return rows;
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
  costCompare, itemRequiresDoc, stampDossier,
};
