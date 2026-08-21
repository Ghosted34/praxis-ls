/**
 * Final invoice (MOD-51) — pure, DB-free rules.
 *
 * THE PRICED DOCUMENT IS THE SOURCE OF THE PRICE (§2.7).
 *
 * `PATCH /final-invoices/:id` accepted any lines at any prices. Nothing checked
 * them against the offer the client actually agreed to, so cost figures lifted
 * off a costing sheet could be billed as if they were prices — which is what
 * happened to invoice fb7db2f3: three lines, 95.7M, at cost, zero margin, no
 * VAT. Closing the qty/price defect (§2.2) stops the numbers being MANGLED on
 * the way in; it does nothing about them being the WRONG NUMBERS.
 *
 * The chain is meant to be costing → simulation → quotation → invoice. The
 * quotation is the only document in it a client has seen and accepted, so it is
 * the only one entitled to set a price.
 *
 * WHAT IS COMPARED, AND WHAT IS NOT
 *
 *   unit_price      MUST match the accepted quotation. This is the contract.
 *   is_disbursement MUST match. A charge quoted as pass-through cannot be
 *                   re-billed as taxable revenue (it changes what the client
 *                   owes, and the DB forbids tax on it either way).
 *   qty             FREE. Quantities are what actually happened — 38 containers
 *                   cleared against 40 quoted is an ordinary fact of the job,
 *                   not a pricing violation. Locking it would force a credit
 *                   note for every real-world variance.
 *
 * An extra line NOT on the quotation is a violation: that is precisely how an
 * unagreed charge reaches a client's bill.
 */
"use strict";

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** The unit price a line is actually asking for, in either payload shape. */
function unitPriceOf(ln) {
  return ln.unit_price !== undefined ? Number(ln.unit_price) : Number(ln.amount);
}

/**
 * Match on the catalogue item, and on the container type when BOTH sides name
 * one (0663) — a quotation may price "THC" differently for a 20' and a 40', and
 * collapsing those would let the cheaper line justify the dearer one.
 */
function findQuoted(quoted, ln) {
  const sameItem = quoted.filter((q) => q.dictionary_item_id === ln.dictionary_item_id);
  if (sameItem.length <= 1) return sameItem[0] || null;
  const box = ln.container_type_ref_id || null;
  return sameItem.find((q) => (q.container_type_ref_id || null) === box) || sameItem[0];
}

/**
 * reconcileAgainstQuotation(lines, quotedLines, opts) → { ok, violations[] }
 *
 * Pure. `opts.tolerance` is an absolute money tolerance on unit price
 * (default 0.01 — one centime, so rounding never trips it, but a real
 * repricing does).
 */
function reconcileAgainstQuotation(lines = [], quotedLines = [], opts = {}) {
  const tolerance = Number.isFinite(Number(opts.tolerance)) ? Number(opts.tolerance) : 0.01;
  const violations = [];
  lines.forEach((ln, i) => {
    const at = ln.label || `line ${i + 1}`;
    const q = findQuoted(quotedLines, ln);
    if (!q) {
      violations.push({
        line_no: i + 1, label: at, code: "NOT_QUOTED",
        message: `"${at}" is not on the accepted quotation — it cannot be billed without one`,
      });
      return;
    }
    const billed = round2(unitPriceOf(ln));
    const agreed = round2(Number(q.unit_price));
    if (!Number.isFinite(billed)) {
      violations.push({ line_no: i + 1, label: at, code: "NO_PRICE", message: `"${at}" states no price` });
      return;
    }
    // Compared in integer centimes, as the margin rules do. Subtracting the
    // majors instead makes 210000.01 - 210000 come out as 0.010000000009313,
    // which a 0.01 tolerance then rejects — a rounding difference reported as
    // a repricing.
    if (Math.abs(Math.round(billed * 100) - Math.round(agreed * 100)) > Math.round(tolerance * 100)) {
      violations.push({
        line_no: i + 1, label: at, code: "PRICE_MISMATCH", quoted: agreed, billed,
        message: `"${at}" was quoted at ${agreed} and is being billed at ${billed}`,
      });
    }
    const billedNature = ln.is_disbursement === true;
    const agreedNature = q.is_disbursement === true;
    if (billedNature !== agreedNature) {
      violations.push({
        line_no: i + 1, label: at, code: "NATURE_MISMATCH",
        quoted: agreedNature ? "disbursement" : "service",
        billed: billedNature ? "disbursement" : "service",
        message: `"${at}" was quoted as ${agreedNature ? "a pass-through disbursement" : "a service"} and is being billed as ${billedNature ? "a pass-through disbursement" : "a service"}`,
      });
    }
  });
  return { ok: violations.length === 0, violations };
}

module.exports = { reconcileAgainstQuotation, unitPriceOf };
