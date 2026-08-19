/**
 * Costing math (MOD-46, KB §6.7) — pure. Disbursements are pass-through:
 * billed at cost, never taxed (assert_line_valid(), 0640, refuses a débours
 * line with a tax code).
 *
 * NO MARGIN HERE (§2.2, owner-approved). Costing answers "what will this cost
 * us?" and stops at HT / VAT / TTC — the legacy costing footer exactly
 * (Subtotal HT / VAT / Total Estimate; api/costing/save.php contains zero
 * margin references, and all 54 'margin' hits in the legacy
 * view costing-module.php files are CSS). Margin is a PRICING question owned by margin_simulation and
 * quotation — which is why the legacy margin simulator has a LINK COSTING
 * dropdown. This module previously computed a sell price from
 * costing.margin_percent, putting margin in two places with nothing keeping
 * them honest; the column is deprecated (kept nullable, never written) and
 * the sell fields are gone.
 */
"use strict";
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);

/**
 * lines → { service_cost, disbursement_total, total_ht, vat_total, total_ttc }.
 *
 * VAT is per line from the line's own tax code rate (`tax_rate_percent`,
 * joined by the repo). A line with no tax code carries no VAT; débours can
 * never carry one (DB rule). Nothing here reads a hardcoded rate.
 */
function computeCosting(lines) {
  let serviceCost = 0;
  let disbursementTotal = 0;
  let vatTotal = 0;
  for (const l of lines) {
    const amt = num(l.qty) * num(l.unit_cost);
    if (l.is_disbursement) {
      disbursementTotal += amt;
    } else {
      serviceCost += amt;
      vatTotal += amt * (num(l.tax_rate_percent) / 100);
    }
  }
  serviceCost = round2(serviceCost);
  disbursementTotal = round2(disbursementTotal);
  vatTotal = round2(vatTotal);
  const totalHt = round2(serviceCost + disbursementTotal);
  return {
    service_cost: serviceCost,
    disbursement_total: disbursementTotal,
    // The legacy footer, by its three names: Subtotal (HT) / VAT / Total Estimate.
    total_ht: totalHt,
    vat_total: vatTotal,
    total_ttc: round2(totalHt + vatTotal),
    // Kept for readers that summed the old shape; same value as total_ht.
    total_cost: totalHt,
  };
}

/** Budget (costing) vs actual (cost_entry sum) reconciliation for a dossier. */
function reconcile(budgetTotalCost, actualTotal) {
  const b = num(budgetTotalCost);
  const a = num(actualTotal);
  const variance = round2(a - b);
  return { budget: round2(b), actual: round2(a), variance, variance_percent: b ? round2((variance / b) * 100) : null, over_budget: a > b };
}

module.exports = { computeCosting, reconcile };
