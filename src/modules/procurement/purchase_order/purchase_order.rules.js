/** Purchase order (MOD-60) — pure lifecycle + totals.
 *  DRAFT→ISSUED_LOCKED→APPROVED_LOCKED→RECEIVED→CLOSED (or CANCELLED from DRAFT/ISSUED). */
"use strict";
const { AppError } = require("../../../utils/errors");

const NEXT = {
  DRAFT: ["ISSUED_LOCKED", "CANCELLED"],
  ISSUED_LOCKED: ["APPROVED_LOCKED", "CANCELLED"],
  APPROVED_LOCKED: ["RECEIVED", "PARTIAL", "PAID", "CANCELLED"],
  // A PO paid in instalments (10721) — the legacy po_mark_paid story. PARTIAL
  // may also move to RECEIVED (goods arrive after a first payment).
  PARTIAL: ["PAID", "RECEIVED"],
  RECEIVED: ["CLOSED"],
  PAID: [],
  // The unlock loop (10721, mirroring costing 10718): UNLOCK returns to DRAFT,
  // DENY_UNLOCK back to APPROVED_LOCKED. Reached only via unlockTransition.
  UNLOCK_REQUESTED: ["DRAFT", "APPROVED_LOCKED"],
  CLOSED: [],
  CANCELLED: [],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move purchase order ${from} -> ${to}`, 422);
  return true;
}

/** The unlock loop (10721) — same shape as costing's UNLOCK_FLOW (10718). */
const UNLOCK_FLOW = {
  REQUEST_UNLOCK: { from: "APPROVED_LOCKED", to: "UNLOCK_REQUESTED" },
  // DRAFT is the only status updateDraft will edit, so reopening anywhere else
  // would be unlocked in name and still uneditable in fact (costing's reasoning,
  // 10718).
  UNLOCK: { from: "UNLOCK_REQUESTED", to: "DRAFT" },
  DENY_UNLOCK: { from: "UNLOCK_REQUESTED", to: "APPROVED_LOCKED" },
};

/**
 * The status a PO is in once `paid` of `requested` has been paid — DERIVED,
 * never set by hand (same rule as cash_request.disbursementState and
 * supplier_invoice.payState). A RECEIVED PO that is fully paid closes (the
 * delivery and the settlement are both done); a RECEIVED PO partly paid keeps
 * its delivery state — the money figure lives on amount_paid. Over-payment is
 * refused, not clamped: the money has left the treasury by the time this runs.
 */
function poPayState(current, requested, paid) {
  const req = round2(Number(requested || 0));
  const out = round2(Number(paid || 0));
  if (out > req) {
    throw new AppError("OVER_PAID", `Payments total ${out} against a PO of ${req} — ${round2(out - req)} more than it owes`, 422);
  }
  if (out <= 0) return current;
  const full = out >= req;
  if (current === "RECEIVED") return full ? "CLOSED" : "RECEIVED";
  return full ? "PAID" : "PARTIAL";
}

const round2 = (n) => Math.round(n * 100) / 100;
/** Sum of qty*unit_price across items, in major units (HT). */
function computeTotal(items) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError("NO_ITEMS", "a purchase order needs at least one item", 422);
  let cents = 0;
  items.forEach((it, i) => {
    const qty = Number(it.qty);
    const up = Number(it.unit_price);
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError("INVALID_QTY", `item ${i + 1}: qty must be > 0`, 422);
    if (!Number.isFinite(up) || up < 0) throw new AppError("INVALID_PRICE", `item ${i + 1}: unit_price must be >= 0`, 422);
    cents += Math.round(up * 100) * qty;
  });
  return round2(cents / 100);
}

/**
 * HT / VAT / TTC totals for a PO, with VAT resolved per line.
 *
 * `taxRateOf(dictionaryItemId)` returns the effective VAT rate percent for a
 * line (from the dictionary item's tax_code — versioned rows, never literals),
 * or 0/null when the item has none. A line without a tax code is HT-only; a
 * débours line is exactly that case. Rounding is per line (each line's VAT
 * rounded to centimes, then summed) so the document's line table always adds
 * up to its totals.
 */
function computeTotals(items, taxRateOf) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError("NO_ITEMS", "a purchase order needs at least one item", 422);
  const rateOf = typeof taxRateOf === "function" ? taxRateOf : () => 0;
  let ht = 0;
  let vat = 0;
  items.forEach((it, i) => {
    const qty = Number(it.qty);
    const up = Number(it.unit_price);
    if (!Number.isFinite(qty) || qty <= 0) throw new AppError("INVALID_QTY", `item ${i + 1}: qty must be > 0`, 422);
    if (!Number.isFinite(up) || up < 0) throw new AppError("INVALID_PRICE", `item ${i + 1}: unit_price must be >= 0`, 422);
    const lineHt = round2(qty * up);
    ht += lineHt;
    const rate = Number(rateOf(it.dictionary_item_id || null) || 0);
    if (rate > 0) vat += round2((lineHt * rate) / 100);
  });
  return { total_ht: round2(ht), total_vat: round2(vat), total_ttc: round2(ht + vat) };
}

/** Net payable = TTC − withholding (air_rate % of HT) − advance already paid. */
function netPayable({ total_ttc, total_ht, air_rate, adv_paid }) {
  const ttc = Number(total_ttc || 0);
  const ht = Number(total_ht || 0);
  const air = round2((ht * Number(air_rate || 0)) / 100);
  return round2(ttc - air - Number(adv_paid || 0));
}

/** Due date = delivery date + payment days, when both are known. */
function dueOn(deliveryOn, payDays) {
  const days = Number(payDays || 0);
  if (!deliveryOn || days <= 0) return null;
  const d = new Date(String(deliveryOn).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { NEXT, assertTransition, computeTotal, computeTotals, netPayable, dueOn, UNLOCK_FLOW, poPayState };
