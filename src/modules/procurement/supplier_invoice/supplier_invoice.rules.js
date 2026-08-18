/**
 * Supplier invoice (MOD-61) — pure three-way-match + posting maths (KB §8.5).
 * Match reconciles PR↔PO↔GRN↔invoice: a GRN must exist, the invoiced amount must
 * agree with the PO within tolerance, quantities must not be over-invoiced, and
 * the PO/invoice currencies must agree. Posting lines are built here so they
 * are unit-testable and always balance.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const round2 = (n) => Math.round(n * 100) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);
const pct = (a, b) => (b > 0 ? round2((Math.abs(a - b) / b) * 100) : (a > 0 ? 100 : 0));

/**
 * matchThreeWay({ poTotal, invoiceTotalHt, grnExists, tolerancePercent,
 *                 prTotal, poLines, grnLines, invoiceLines, poCurrency,
 *                 invoiceCurrency }).
 *
 * The amount check is the original two-way match. The rest make it a real
 * PR↔PO↔GRN↔invoice reconciliation (analysis doc §6.6):
 *
 *   · PR vs PO — when the request's estimated total is known, it must agree
 *     with the PO within tolerance (both are HT line sums).
 *   · quantities — per dictionary item: Σ GRN received must not exceed PO
 *     ordered (a receipt over the order), and the invoiced qty must not exceed
 *     Σ received (billing for goods that never arrived).
 *   · currency — a PO in XAF billed in EUR cannot match by amount alone; the
 *     currencies must be equal (or the PO must have none, defaulting XAF).
 */
function matchThreeWay({
  poTotal, invoiceTotalHt, grnExists, tolerancePercent = 0,
  prTotal = null, poLines = [], grnLines = [], invoiceLines = [],
  poCurrency = null, invoiceCurrency = null,
}) {
  const reasons = [];
  if (!grnExists) reasons.push("no goods-received note for this PO");

  const po = cents(poTotal);
  const inv = cents(invoiceTotalHt);
  const variancePct = pct(inv, po);
  if (variancePct > Number(tolerancePercent)) reasons.push(`amount variance ${variancePct}% exceeds tolerance ${tolerancePercent}%`);

  if (prTotal !== null && prTotal !== undefined && cents(prTotal) > 0) {
    const prVariance = pct(cents(prTotal), po);
    if (prVariance > Number(tolerancePercent)) {
      reasons.push(`purchase-request total ${round2(cents(prTotal) / 100)} differs from PO total ${round2(po / 100)} (${prVariance}%)`);
    }
  }

  // ── quantities, per dictionary item ─────────────────────────────────────
  const sumQty = (rows) => {
    const m = new Map();
    (rows || []).forEach((l) => {
      const id = l.dictionary_item_id || l.label || "?";
      m.set(id, (m.get(id) || 0) + Number(l.qty || l.received || 0));
    });
    return m;
  };
  const ordered = sumQty(poLines);
  const received = sumQty(grnLines);
  const invoiced = sumQty(invoiceLines);
  const itemLabel = (id) => {
    const hit = [...(poLines || []), ...(grnLines || []), ...(invoiceLines || [])].find((l) => (l.dictionary_item_id || l.label) === id);
    return (hit && (hit.label || hit.dictionary_item_id)) || id;
  };
  for (const [id, qty] of received) {
    const ord = ordered.get(id) || 0;
    if (qty > ord + 1e-9) reasons.push(`over-received: ${itemLabel(id)} (received ${qty} of ordered ${ord})`);
  }
  for (const [id, qty] of invoiced) {
    const rec = received.get(id) || 0;
    if (qty > rec + 1e-9) reasons.push(`invoiced qty ${qty} exceeds received ${rec} for ${itemLabel(id)}`);
  }

  // ── currency ────────────────────────────────────────────────────────────
  const poCcy = (poCurrency || "XAF").toUpperCase();
  const invCcy = (invoiceCurrency || "XAF").toUpperCase();
  if (poCcy !== invCcy) reasons.push(`currency mismatch (PO in ${poCcy}, invoice in ${invCcy})`);

  return {
    matched: reasons.length === 0,
    variance_percent: variancePct,
    po_total: round2(po / 100),
    invoice_total_ht: round2(inv / 100),
    reasons,
  };
}

/**
 * buildPaymentLines({ amount, supplierAccount, treasuryAccount }) — the AP
 * settlement posting (KB §8.5): Dr supplier (4011) / Cr treasury. Balanced by
 * construction; `treasuryAccount` must be a postable COA code (the caller
 * resolves it through treasury_account.coa_code or accountFor("treasury")).
 */
function buildPaymentLines({ amount, supplierAccount = "4011", treasuryAccount }) {
  const amt = round2(Number(amount || 0));
  if (!(amt > 0)) throw new AppError("BAD_AMOUNT", "payment amount must be > 0", 422);
  if (!treasuryAccount) throw new AppError("NO_TREASURY_ACCOUNT", "treasury account code is required to pay a supplier invoice", 422);
  return [
    { account_code: supplierAccount, debit: amt, credit: 0 },
    { account_code: treasuryAccount, debit: 0, credit: amt },
  ];
}

/**
 * The status an invoice is in once `paid` of `ttc` has been paid — DERIVED,
 * never set by hand, so the state and the payment rows can never disagree
 * (same rule as cash_request.disbursementState, 10719). Over-payment is
 * refused: the money has left the bank before this runs.
 */
function payState(totalTtc, paid) {
  const ttc = round2(Number(totalTtc || 0));
  const out = round2(Number(paid || 0));
  if (out > ttc) {
    throw new AppError("OVER_PAID", `Payments total ${out} against an invoice of ${ttc} — ${round2(out - ttc)} more than it owes`, 422);
  }
  if (out <= 0) return "POSTED_LOCKED";
  return out >= ttc ? "PAID" : "POSTED_LOCKED";
}

/**
 * buildPostingLines({ lines, vatTotal, whtTotal, supplierAccount, vatAccount, whtAccount })
 * → balanced legs: Dr expense (per line) + Dr input-VAT; Cr supplier (net of WHT) + Cr WHT.
 * lines = [{ expense_account, qty, unit_price }].
 */
function buildPostingLines({ lines, vatTotal = 0, whtTotal = 0, dossierId = null, supplierAccount = "4011", vatAccount = "4452", whtAccount = "4471" }) {
  if (!Array.isArray(lines) || lines.length === 0) throw new AppError("NO_LINES", "supplier invoice needs at least one line", 422);
  const legs = [];
  let htCents = 0;
  lines.forEach((ln, i) => {
    const acct = ln.expense_account;
    if (!acct) throw new AppError("NO_EXPENSE_ACCOUNT", `line ${i + 1}: expense_account (6xx) is required`, 422);
    const lineHt = Math.round(cents(ln.unit_price) * Number(ln.qty || 1));
    if (lineHt <= 0) throw new AppError("ZERO_LINE", `line ${i + 1}: amount must be > 0`, 422);
    htCents += lineHt;
    legs.push({ account_code: acct, debit: round2(lineHt / 100), credit: 0, dossier_id: dossierId, dictionary_item_id: ln.dictionary_item_id || null });
  });
  const vat = cents(vatTotal);
  const wht = cents(whtTotal);
  if (vat > 0) legs.push({ account_code: vatAccount, debit: round2(vat / 100), credit: 0, dossier_id: null });
  const supplierCredit = htCents + vat - wht;
  if (supplierCredit <= 0) throw new AppError("BAD_TOTALS", "supplier net payable must be > 0", 422);
  legs.push({ account_code: supplierAccount, debit: 0, credit: round2(supplierCredit / 100), dossier_id: null });
  if (wht > 0) legs.push({ account_code: whtAccount, debit: 0, credit: round2(wht / 100), dossier_id: null });
  return { lines: legs, amount_ht: round2(htCents / 100), amount_ttc: round2((htCents + vat) / 100) };
}

module.exports = { matchThreeWay, buildPostingLines, buildPaymentLines, payState };
