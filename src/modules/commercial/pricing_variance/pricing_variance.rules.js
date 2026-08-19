/**
 * Pricing Variance Index (MOD-27) — pure rules. Margin% = (quoted − actual_cost)
 * / quoted; a R/Y/G flag comes from tenant thresholds. The raw cost is NEVER
 * placed in the Sales view (finance boundary): `salesView` strips it.
 *
 * Since §2.1 the index is DERIVED from the dossier reconciliation (quoted at
 * header level, budget/actual summed from its lines) — these functions compute
 * the projection; nothing stores variance_percent or the flag any more.
 */
"use strict";
const round2 = (n) => Math.round(n * 100) / 100;

/** { quotedPrice, actualCost } → { margin_percent }. */
function computeVariance({ quotedPrice, actualCost }) {
  const q = Number(quotedPrice) || 0;
  const c = Number(actualCost) || 0;
  const marginPercent = q > 0 ? round2(((q - c) / q) * 100) : (c > 0 ? -100 : 0);
  return { margin_percent: marginPercent, margin_amount: round2(q - c) };
}

/** flagFor(marginPercent, { green_min, yellow_min }) → GREEN | YELLOW | RED. */
function flagFor(marginPercent, thresholds = {}) {
  const green = Number(thresholds.green_min ?? 20);
  const yellow = Number(thresholds.yellow_min ?? 10);
  if (marginPercent >= green) return "GREEN";
  if (marginPercent >= yellow) return "YELLOW";
  return "RED";
}

/** Projection row (reconciliation + line aggregates) → the computed index.
 *  A file with no accepted quotation has quoted_ht null: the execution
 *  question is still answerable but margin/flag are null, not a fake RED. */
function projectRow(row, thresholds = {}) {
  const quoted = row.quoted_ht === null || row.quoted_ht === undefined ? null : Number(row.quoted_ht);
  const budget = Number(row.budget_ht) || 0;
  const actual = Number(row.actual_ht) || 0;
  const out = {
    reconciliation_id: row.reconciliation_id,
    dossier_id: row.dossier_id,
    quotation_id: row.quotation_id,
    reconciliation_status: row.status,
    quoted_ht: quoted,
    budget_ht: round2(budget),
    actual_ht: round2(actual),
    budget_vs_actual: round2(budget - actual),
    quote_vs_budget: null,
    quote_vs_actual: null,
    variance_percent: null,
    flag: null,
    computed_at: row.validated_at || row.created_at,
  };
  if (quoted !== null) {
    out.quote_vs_budget = round2(quoted - budget);
    out.quote_vs_actual = round2(quoted - actual);
    out.variance_percent = computeVariance({ quotedPrice: quoted, actualCost: actual }).margin_percent;
    out.flag = flagFor(out.variance_percent, thresholds);
  }
  return out;
}

/** Strip every cost figure for the Sales-facing view. Sales keeps seeing the
 *  margin % and the flag WITHOUT budget/actual — losing this split would be a
 *  data leak (§2.1.5). */
function salesView(row) {
  if (!row) return null;
  return {
    reconciliation_id: row.reconciliation_id,
    dossier_id: row.dossier_id,
    quotation_id: row.quotation_id,
    reconciliation_status: row.reconciliation_status,
    quoted_ht: row.quoted_ht === undefined ? undefined : row.quoted_ht,
    variance_percent: row.variance_percent === undefined ? undefined : row.variance_percent,
    flag: row.flag,
    computed_at: row.computed_at,
  };
}

module.exports = { computeVariance, flagFor, projectRow, salesView };
