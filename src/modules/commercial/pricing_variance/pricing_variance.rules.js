/**
 * Pricing Variance Index (MOD-27) — pure rules. Margin% = (quoted − actual_cost)
 * / quoted; a R/Y/G flag comes from tenant thresholds. The raw cost is NEVER
 * placed in the Sales view (finance boundary): `salesView` strips it.
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

/** Strip the finance-only fields (actual_cost) for the Sales-facing view. */
function salesView(row) {
  if (!row) return null;
  return {
    pricing_variance_id: row.pricing_variance_id,
    dossier_id: row.dossier_id,
    quotation_id: row.quotation_id,
    quoted_price: row.quoted_price === undefined ? undefined : Number(row.quoted_price),
    variance_percent: row.variance_percent === undefined ? undefined : Number(row.variance_percent),
    flag: row.flag,
    computed_at: row.computed_at,
  };
}

module.exports = { computeVariance, flagFor, salesView };
