/**
 * Pure invoicing math (KB §7/§8.3) — no DB, cent-accurate, unit-testable.
 *  - computeTotals: split resolved lines into service HT / débours / VAT / TTC.
 *  - applyAdvances: FIFO-allocate customer advances (4191) against a TTC total,
 *    returning what to clear (Dr 4191 / Cr 4111) and the net still due.
 * The GL postings themselves go through determination + the ledger engine.
 */
"use strict";

const { AppError } = require("../../utils/errors");

const toCents = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError("INVALID_AMOUNT", "amount must be a non-negative number", 422);
  const c = Math.round(n * 100);
  if (Math.abs(n * 100 - c) > 1e-6) throw new AppError("INVALID_AMOUNT", "amount may have at most 2 decimals", 422);
  return c;
};
const major = (cents) => cents / 100;

/** resolvedLines[]: { amount, isDisbursement?, taxRate? }  (taxRate = percent). */
function computeTotals(resolvedLines) {
  if (!Array.isArray(resolvedLines) || resolvedLines.length === 0) {
    throw new AppError("NO_LINES", "at least one line is required", 422);
  }
  let serviceCents = 0;
  let disbursementCents = 0;
  let vatCents = 0;
  for (const ln of resolvedLines) {
    const ht = toCents(ln.amount);
    if (ln.isDisbursement) {
      disbursementCents += ht;
    } else {
      serviceCents += ht;
      if (ln.taxRate) vatCents += Math.round((ht * Number(ln.taxRate)) / 100);
    }
  }
  const totalCents = serviceCents + vatCents + disbursementCents;
  return {
    service_ht: major(serviceCents),
    disbursement_total: major(disbursementCents),
    vat_total: major(vatCents),
    total_ttc: major(totalCents),
  };
}

/**
 * Allocate advances (each { advance_id, amount, applied_amount }) against a TTC
 * total, oldest first. Returns { applied_total, net_due, allocations }.
 */
function applyAdvances(totalTtc, advances = []) {
  let remaining = toCents(totalTtc);
  const allocations = [];
  let appliedCents = 0;
  for (const adv of advances) {
    if (remaining <= 0) break;
    const available = toCents(adv.amount) - toCents(adv.applied_amount || 0);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    allocations.push({ advance_id: adv.advance_id, amount: major(take) });
    appliedCents += take;
    remaining -= take;
  }
  return { applied_total: major(appliedCents), net_due: major(remaining), allocations };
}

module.exports = { computeTotals, applyAdvances, toCents };
