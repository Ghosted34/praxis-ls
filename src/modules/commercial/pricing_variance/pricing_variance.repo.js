/** Pricing-variance repository (MOD-27) — a DERIVED, READ-ONLY projection over
 *  dossier_reconciliation (§2.1). Nothing here writes: the stored
 *  pricing_variance table was retired by migration 10741 (its scalar could not
 *  be drilled into, and compute() accepted a caller-supplied actual — BUG-4).
 *  All SQL lives here. The Sales path deliberately NEVER selects the cost
 *  aggregates. */
"use strict";

const costingRepo = require("../../costing/costing/costing.repo");

/**
 * One projection row per reconciliation: header quoted + the two aggregates.
 *
 * ── WHY THIS READS `costing_line` AND NOT THE RECONCILIATION'S OWN COLUMNS ──
 *
 * It used to `SUM(l.budget_ht)` and `SUM(l.actual_ht)` off
 * `dossier_reconciliation_line`. 13801 retired both columns: the reconciliation
 * grid is TTC (owner decision Q4), and its line table became SPARSE — it stores
 * only what a human typed, and a budget line nobody has touched has no row at
 * all. Summing a column that is no longer written would report every file as
 * costing zero, and a margin flag that reads GREEN because the data moved is
 * worse than no flag.
 *
 * So the budget comes from where budgets live — the approved costing — and the
 * actual is the TTC a person entered, with that line's own VAT stripped back
 * off. HT on both sides, débours excluded on both sides (OHADA_KB §450: a
 * disbursement is neither revenue nor cost, so it must not move the margin).
 *
 * ── THE ACTUAL COUNTS ONLY WHAT WAS ACTUALLY RECORDED ───────────────────────
 *
 * The reconciliation SCREEN pre-fills an untouched line with what was disbursed
 * — a useful hypothesis to put in front of a person ("we gave you 119 250, is
 * that what you spent?"). This projection deliberately does NOT adopt it.
 * `COALESCE(rl.actual_ttc, 0)` means a line nobody has answered for contributes
 * nothing, because a margin computed from an assumption is a number Sales would
 * act on and no one verified.
 */
const VAT = costingRepo.LINE_VAT_SQL;
const NET = "cl.qty * cl.unit_cost";

const PROJECTION = `
  SELECT r.reconciliation_id, r.dossier_id, r.quotation_id, r.status,
         r.quoted_ht, r.created_at,
         COALESCE(r.settled_at, r.validated_at) AS validated_at,
         COALESCE(agg.budget_ht, 0) AS budget_ht,
         COALESCE(agg.actual_ht, 0) AS actual_ht
    FROM dossier_reconciliation r
    LEFT JOIN LATERAL (
      SELECT
        SUM(${NET}) FILTER (WHERE NOT COALESCE(cl.is_disbursement, false)) AS budget_ht,
        SUM(
          COALESCE(rl.actual_ttc, 0)
          * CASE WHEN (${NET} + ${VAT}) > 0 THEN (${NET}) / (${NET} + ${VAT}) ELSE 1 END
        ) FILTER (WHERE NOT COALESCE(cl.is_disbursement, false)) AS actual_ht
        FROM costing_line cl
        JOIN costing c ON c.costing_id = cl.costing_id
        LEFT JOIN tax_code tc ON tc.tax_code_id = cl.tax_code_id
        LEFT JOIN dossier_reconciliation_line rl
               ON rl.reconciliation_id = r.reconciliation_id
              AND rl.costing_line_id = cl.costing_line_id
       WHERE c.dossier_id = r.dossier_id AND c.status = 'APPROVED_LOCKED'
    ) agg ON TRUE
`;

async function projectionList(client, { dossierId = null, limit = 50, offset = 0 }) {
  const params = [Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200), Math.max(parseInt(offset, 10) || 0, 0)];
  let where = "";
  if (dossierId) { params.push(dossierId); where = "WHERE r.dossier_id = $" + params.length; }
  const { rows } = await client.query(
    PROJECTION + ` ${where}
     ORDER BY r.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

async function projectionGet(client, reconciliationId) {
  const { rows } = await client.query(
    PROJECTION + " WHERE r.reconciliation_id = $1",
    [reconciliationId],
  );
  return rows[0] || null;
}

/**
 * Finance drill-in: the lines behind a red flag — exactly what the retired
 * scalar could not show.
 *
 * Driven from `costing_line` for the same reason the projection is: a budget
 * line nobody has recorded an actual against still has to appear, because an
 * unanswered line is one of the things a red flag can mean.
 */
async function projectionLines(client, reconciliationId) {
  const { rows } = await client.query(
    `SELECT rl.line_id, cl.costing_line_id, cl.dictionary_item_id,
            di.code AS item_code,
            COALESCE(di.label_en, di.label_fr, cl.label) AS item_label,
            COALESCE(cl.is_disbursement, false) AS is_disbursement,
            ROUND(${NET}, 2)                                       AS budget_ht,
            ROUND(COALESCE(rl.actual_ttc, 0)
                  * CASE WHEN (${NET} + ${VAT}) > 0
                         THEN (${NET}) / (${NET} + ${VAT}) ELSE 1 END, 2) AS actual_ht,
            rl.actual_ttc, rl.actual_source, rl.variance_reason
       FROM dossier_reconciliation r
       JOIN costing c ON c.dossier_id = r.dossier_id AND c.status = 'APPROVED_LOCKED'
       JOIN costing_line cl ON cl.costing_id = c.costing_id
       LEFT JOIN tax_code tc ON tc.tax_code_id = cl.tax_code_id
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = cl.dictionary_item_id
       LEFT JOIN dossier_reconciliation_line rl
              ON rl.reconciliation_id = r.reconciliation_id
             AND rl.costing_line_id = cl.costing_line_id
      WHERE r.reconciliation_id = $1
      ORDER BY cl.line_no, cl.costing_line_id`,
    [reconciliationId],
  );
  return rows;
}

module.exports = { projectionList, projectionGet, projectionLines };
