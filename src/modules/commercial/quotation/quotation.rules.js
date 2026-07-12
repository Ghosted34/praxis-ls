/**
 * Quotation (MOD-27) — pure lifecycle + totals.
 * DRAFT→SENT→ACCEPTED/REJECTED/EXPIRED ; ACCEPTED→CONVERTED (to a final invoice).
 * total_ht = Σ qty·unit_price; total_ttc adds VAT on taxed, non-débours lines at
 * the tenant standard rate (débours are pass-through, never taxed — KB §6/§23.5).
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const NEXT = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: ["CONVERTED"],
  REJECTED: [], EXPIRED: [], CONVERTED: [],
};
function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move quotation ${from} -> ${to}`, 422);
  return true;
}

const round2 = (n) => Math.round(n * 100) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);

/** computeTotals(lines, vatRatePercent) → { total_ht, vat_total, total_ttc }. */
function computeTotals(lines, vatRatePercent = 19.25) {
  let htC = 0;
  let taxableC = 0;
  (lines || []).forEach((l) => {
    const lineC = Math.round(cents(l.unit_price) * Number(l.qty || 1));
    htC += lineC;
    if (l.is_debours !== true && l.tax_code_id) taxableC += lineC;
  });
  const vatC = Math.round(taxableC * (Number(vatRatePercent) / 100));
  return { total_ht: round2(htC / 100), vat_total: round2(vatC / 100), total_ttc: round2((htC + vatC) / 100) };
}

module.exports = { NEXT, assertTransition, computeTotals };
