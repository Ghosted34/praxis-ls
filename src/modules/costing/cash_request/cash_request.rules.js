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

module.exports = { NEXT, assertTransition, sumField, disbursementState };
