/** Cash request / disbursal document (MOD-49) — pure lifecycle.
 *  DRAFT→SUBMITTED→APPROVED→DISBURSED→JUSTIFIED (REJECTED from SUBMITTED/APPROVED). */
"use strict";
const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;

const NEXT = {
  DRAFT: ["SUBMITTED"],
  // The two-step restored (10721, legacy parity): finance validates
  // (SUBMITTED → VALIDATED), management approves (VALIDATED → APPROVED).
  SUBMITTED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["APPROVED", "REJECTED"],
  // A first instalment lands in PARTIALLY_DISBURSED; a single full payment goes
  // straight to DISBURSED. Both are reachable from APPROVED because which one
  // happens depends on the amount paid, not on a separate decision.
  APPROVED: ["PARTIALLY_DISBURSED", "DISBURSED", "REJECTED"],
  // Further instalments keep it here until the total closes the request.
  PARTIALLY_DISBURSED: ["PARTIALLY_DISBURSED", "DISBURSED"],
  DISBURSED: ["JUSTIFIED"],
  JUSTIFIED: [],
  REJECTED: [],
};

/**
 * The status a request is in once `paid` of `requested` has been disbursed.
 *
 * DERIVED, never set by hand — this is the function that makes
 * PARTIALLY_DISBURSED a state something can actually write. `disburse` calls it
 * with the recomputed Σ of the payment rows, so the status and the payments can
 * never disagree.
 *
 * Over-payment is refused rather than clamped: paying out more than was
 * approved is a real error (a duplicated instalment, a typo'd amount), and the
 * money has already left the treasury by the time this runs. Mirrors
 * `regie.rules.recomputeState`, which refuses OVER_RETIRED for the same reason.
 */
function disbursementState(requested, paid) {
  const req = round2(Number(requested || 0));
  const out = round2(Number(paid || 0));
  if (out > req) {
    throw new AppError(
      "OVER_DISBURSED",
      `Payments total ${out} against a request of ${req} — ${round2(out - req)} more than was approved`,
      422,
    );
  }
  if (out <= 0) return "APPROVED";
  return out === req ? "DISBURSED" : "PARTIALLY_DISBURSED";
}

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move cash request ${from} -> ${to}`, 422);
  return true;
}

/** Sum of a numeric field across lines. */
function sumField(lines, field) {
  return round2((lines || []).reduce((s, l) => s + Number(l[field] || 0), 0));
}

/**
 * §3.5 — the voucher footer: Subtotal / VAT / TOTAL PAYABLE. Each line may
 * carry its own VAT %% (legacy per-line "VAT %"); the request's `amount` is
 * the TOTAL PAYABLE, because that is the cash being asked for — a request
 * whose header ignored line VAT under-funded every taxed spend.
 */
function computeTotals(lines) {
  let subtotal = 0;
  let vat = 0;
  for (const l of lines || []) {
    const amt = Number(l.budget_amount || 0);
    subtotal += amt;
    vat += amt * (Number(l.vat_percent || 0) / 100);
  }
  return {
    subtotal: round2(subtotal),
    vat_total: round2(vat),
    total_payable: round2(subtotal + vat),
  };
}

/**
 * §3.5 — the disbursement method and its conditional fields, exactly the
 * legacy's validation (cash-request.php :499, :505-514): BANK needs the bank
 * name + account number + account name, MOMO needs the number + network
 * (MTN/ORANGE), CHEQUE needs the cheque number, CASH needs nothing. Enforced
 * as a rule so every caller — route, AI, import — hits the same wall.
 */
const METHOD_FIELDS = {
  CASH: [],
  BANK: ["bank_name", "account_number", "account_name"],
  CHEQUE: ["cheque_number"],
  MOMO: ["momo_number", "network"],
};

function assertMethod(method, details = {}) {
  const m = String(method || "").toUpperCase();
  const wanted = METHOD_FIELDS[m];
  if (!wanted) throw new AppError("BAD_METHOD", "disbursement_method must be CASH, BANK, CHEQUE or MOMO", 422);
  const d = details || {};
  const missing = wanted.filter((k) => !String(d[k] || "").trim());
  if (missing.length) {
    throw new AppError("METHOD_FIELDS_REQUIRED", `${m} disbursement needs: ${missing.join(", ")}`, 422);
  }
  if (m === "MOMO") {
    const net = String(d.network || "").toUpperCase();
    if (!["MTN", "ORANGE"].includes(net)) throw new AppError("BAD_NETWORK", "MoMo network must be MTN or ORANGE", 422);
  }
  // Only the method's own fields are stored — a method flip never leaves a
  // stale cheque number under a bank transfer.
  const clean = {};
  for (const k of wanted) clean[k] = String(d[k]).trim();
  if (m === "MOMO") clean.network = String(d.network).toUpperCase();
  return { method: m, details: clean };
}

module.exports = { NEXT, assertTransition, sumField, computeTotals, assertMethod, disbursementState };
