/** Pricing-variance repository (MOD-27) — a DERIVED, READ-ONLY projection over
 *  dossier_reconciliation (§2.1). Nothing here writes: the stored
 *  pricing_variance table was retired by migration 10741 (its scalar could not
 *  be drilled into, and compute() accepted a caller-supplied actual — BUG-4).
 *  All SQL lives here. The Sales path deliberately NEVER selects the cost
 *  aggregates. */
"use strict";

/** One projection row per reconciliation: header quoted + the two line
 *  aggregates. All HT, service costs only — the lines exclude débours by
 *  construction (dossier_reconciliation.repo.costCompare). */
const PROJECTION = `
  SELECT r.reconciliation_id, r.dossier_id, r.quotation_id, r.status,
         r.quoted_ht, r.created_at, r.validated_at,
         COALESCE(SUM(l.budget_ht), 0) AS budget_ht,
         COALESCE(SUM(l.actual_ht), 0) AS actual_ht
    FROM dossier_reconciliation r
    LEFT JOIN dossier_reconciliation_line l ON l.reconciliation_id = r.reconciliation_id
`;

async function projectionList(client, { dossierId = null, limit = 50, offset = 0 }) {
  const params = [Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200), Math.max(parseInt(offset, 10) || 0, 0)];
  let where = "";
  if (dossierId) { params.push(dossierId); where = "WHERE r.dossier_id = $" + params.length; }
  const { rows } = await client.query(
    PROJECTION + ` ${where}
     GROUP BY r.reconciliation_id
     ORDER BY r.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

async function projectionGet(client, reconciliationId) {
  const { rows } = await client.query(
    PROJECTION + ` WHERE r.reconciliation_id = $1 GROUP BY r.reconciliation_id`,
    [reconciliationId],
  );
  return rows[0] || null;
}

/** Finance drill-in: the per-item lines behind a red flag — exactly what the
 *  retired scalar could not show. */
async function projectionLines(client, reconciliationId) {
  const { rows } = await client.query(
    `SELECT line_id, dictionary_item_id, item_code, item_label,
            budget_ht, actual_ht, match_status, doc_ref, doc_required
       FROM dossier_reconciliation_line
      WHERE reconciliation_id = $1
      ORDER BY item_code, line_id`,
    [reconciliationId],
  );
  return rows;
}

module.exports = { projectionList, projectionGet, projectionLines };
