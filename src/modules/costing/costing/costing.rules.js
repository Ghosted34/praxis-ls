/**
 * Costing math (MOD-46, KB §6.7) — pure. Disbursements are pass-through: excluded from
 * the margin base. Margin % applies to the SERVICE cost only; débours are billed
 * at cost. sell_ht = service_cost*(1+m/100) + débours.
 */
"use strict";
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);

function computeCosting(lines, marginPercent = 0) {
  let serviceCost = 0;
  let disbursementTotal = 0;
  for (const l of lines) {
    const amt = num(l.qty) * num(l.unit_cost);
    if (l.is_disbursement) disbursementTotal += amt; else serviceCost += amt;
  }
  serviceCost = round2(serviceCost);
  disbursementTotal = round2(disbursementTotal);
  const m = num(marginPercent);
  const serviceSell = round2(serviceCost * (1 + m / 100));
  return {
    service_cost: serviceCost,
    disbursement_total: disbursementTotal,
    total_cost: round2(serviceCost + disbursementTotal),
    service_sell_ht: serviceSell,
    margin_amount: round2(serviceSell - serviceCost),
    margin_percent: m,
    sell_ht: round2(serviceSell + disbursementTotal),
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
