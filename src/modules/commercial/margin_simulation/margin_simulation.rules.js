/**
 * Margin simulator (MOD-27) — pure, DB-free quote maths (KB §6.7).
 * Margin is earned on SERVICES only; débours (pass-through disbursements) are
 * excluded from the margin base but still shown as cost = price (zero markup).
 *
 * Money is summed in integer centimes to avoid float drift, then returned major.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;

function cents(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError("INVALID_AMOUNT", `${label} must be a non-negative number`, 422);
  return Math.round(n * 100);
}

/**
 * computeMargin(lines) where each line is
 *   { qty, unit_cost, unit_price, is_disbursement? }
 * Returns totals in major units plus the service-only margin.
 */
function computeMargin(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new AppError("NO_LINES", "at least one line is required", 422);
  }
  let costC = 0;
  let priceC = 0;
  let svcCostC = 0;
  let svcPriceC = 0;
  let disbursementC = 0;
  lines.forEach((ln, i) => {
    const at = `line ${i + 1}`;
    const qty = Number(ln.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError("INVALID_QTY", `${at}: qty must be > 0`, 422);
    const lineCost = Math.round(cents(ln.unit_cost, `${at} unit_cost`) * qty);
    const linePrice = Math.round(cents(ln.unit_price, `${at} unit_price`) * qty);
    costC += lineCost;
    priceC += linePrice;
    if (ln.is_disbursement === true) {
      disbursementC += lineCost;
    } else {
      svcCostC += lineCost;
      svcPriceC += linePrice;
    }
  });
  const marginC = svcPriceC - svcCostC;
  const marginPercent = svcPriceC > 0 ? round2((marginC / svcPriceC) * 100) : 0;
  const markupPercent = svcCostC > 0 ? round2((marginC / svcCostC) * 100) : 0;
  return {
    total_cost: round2(costC / 100),
    total_price: round2(priceC / 100),
    service_cost: round2(svcCostC / 100),
    service_price: round2(svcPriceC / 100),
    disbursement_total: round2(disbursementC / 100),
    margin_amount: round2(marginC / 100),
    margin_percent: marginPercent,
    markup_percent: markupPercent,
  };
}

/**
 * Given a target margin % (on price) and a cost, the price that achieves it.
 *   price = cost / (1 - margin/100)   (margin < 100)
 */
function priceForMargin(cost, marginPercent) {
  const c = Number(cost);
  const m = Number(marginPercent);
  if (!Number.isFinite(c) || c < 0) throw new AppError("INVALID_AMOUNT", "cost must be >= 0", 422);
  if (!Number.isFinite(m) || m < 0 || m >= 100) throw new AppError("INVALID_MARGIN", "margin_percent must be in [0,100)", 422);
  return round2(c / (1 - m / 100));
}

module.exports = { computeMargin, priceForMargin };
