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
  // Further instalments keep it here until the total closes the request — or
  // CLOSE_BALANCE settles it short (12771). Without that last exit a part-paid
  // request holds committed budget for ever against cash that will never move,
  // which is a slow leak under commitment accounting.
  PARTIALLY_DISBURSED: ["PARTIALLY_DISBURSED", "DISBURSED", "CLOSED_SHORT"],
  DISBURSED: ["JUSTIFIED"],
  // Money left the treasury, so it still has to be accounted for: a settled
  // request is justified exactly like a fully disbursed one.
  CLOSED_SHORT: ["JUSTIFIED"],
  JUSTIFIED: [],
  // 12771: REJECTED is no longer terminal. The legacy let a rejected request be
  // edited and re-submitted (pr_save accepts DRAFT and REJECTED; pr_transition
  // SUBMIT accepts from ∈ {DRAFT, REJECTED}), and ours did not — so a mistyped
  // MoMo number cost a whole document and its reference. Reopening keeps both,
  // and the rejection stamp stays on the row as the reason it came back.
  REJECTED: ["DRAFT"],
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

/**
 * What ONE line claims against its budget line — TTC (12771).
 *
 * TTC because the budget is TTC: `costing.rules.lineTtc` counts the supplier's
 * VAT on a débours as budgeted cash, so a claim that ignored its own VAT would
 * draw down a smaller number than the money it actually takes out of the
 * treasury.
 *
 * ROUNDED PER LINE. `computeTotals` below rounds the VAT of the whole sheet
 * once, at the foot, because that is what prints on the voucher; a budget claim
 * has to be a stable per-line number that a per-line balance can be compared
 * against. On a sheet with several fractionally-taxed lines the two can differ
 * by a sub-unit — never more. The SQL twin of this expression lives in
 * `costing.repo.budgetForCosting`; the two must not drift.
 */
function lineClaim(l = {}) {
  const net = Number(l.budget_amount || 0);
  return round2(net * (1 + Number(l.vat_percent || 0) / 100));
}

/**
 * Which budget lines this request would overdraw, and by how much (12771).
 *
 * `ledger` is `costing.repo.budgetForCosting` for the linked costing, whose
 * `remaining` already excludes this request: a DRAFT, SUBMITTED or VALIDATED
 * request commits nothing (only APPROVED and beyond do), so the balance it
 * reports is exactly what is left for this request to claim.
 *
 * Claims are TOTALLED PER BUDGET LINE FIRST. One request can legitimately carry
 * two lines against the same budget line — a partial claim plus a top-up typed
 * later — and checking them one at a time would pass each while the pair
 * overdraws.
 *
 * Pure: the caller decides what a breach means. At submission it demands a
 * written reason; at approval it is a refusal (owner decision Q3).
 */
function budgetBreaches(lines = [], ledger = []) {
  const byLine = new Map(ledger.map((r) => [r.costing_line_id, r]));
  const claimed = new Map();
  for (const l of lines) {
    if (!l.costing_line_id) continue;
    claimed.set(l.costing_line_id, round2((claimed.get(l.costing_line_id) || 0) + lineClaim(l)));
  }
  const breaches = [];
  for (const [costingLineId, claim] of claimed) {
    const row = byLine.get(costingLineId);
    // A claim against a budget line that is no longer on the sheet is the
    // hardest breach there is: nothing is left, because there is nothing.
    const remaining = row ? round2(Number(row.remaining || 0)) : 0;
    if (claim > remaining) {
      breaches.push({
        costing_line_id: costingLineId,
        label: row ? row.label : null,
        claim,
        remaining,
        excess: round2(claim - remaining),
      });
    }
  }
  return breaches;
}

/**
 * Split what was ACTUALLY paid across the lines of a request being settled
 * short (12771) — CLOSE_BALANCE's arithmetic.
 *
 * Instalments are paid against the request, not against its lines (owner
 * decision Q15), so there is no recorded per-line truth to use; pro-rata by
 * claim is the only honest derivation, and `settled_amount` records it so the
 * budget ledger stops counting money that will never move.
 *
 * THE LAST LINE ABSORBS THE REMAINDER, so the parts sum to the whole exactly.
 * Distributing rounding evenly would leave the ledger a sub-unit away from the
 * cash actually issued, and a budget that disagrees with the treasury by any
 * amount is a budget people stop trusting.
 */
function apportionSettlement(lines = [], paidTotal = 0) {
  const claims = lines.map(lineClaim);
  const total = round2(claims.reduce((a, b) => a + b, 0));
  const paid = round2(Number(paidTotal || 0));
  if (!(total > 0)) return lines.map(() => 0);
  if (paid >= total) return claims;

  const shares = claims.map((c) => round2((c * paid) / total));
  const assigned = round2(shares.reduce((a, b) => a + b, 0));
  const drift = round2(paid - assigned);
  if (drift !== 0) {
    // The last line with a non-zero share, so the remainder never lands on a
    // line that claimed nothing.
    for (let i = shares.length - 1; i >= 0; i -= 1) {
      if (shares[i] > 0) { shares[i] = round2(shares[i] + drift); break; }
    }
  }
  return shares;
}

/**
 * The ledger as a request-shaped summary — what a validator and an approver
 * need to see before they act (owner decision Q20).
 *
 * Finance validates against the budget, so the question "is this file budgeted
 * for, and is this request inside it?" has to be answerable without leaving the
 * screen. Pure, so the same numbers can be rendered on the worksheet, printed
 * on the voucher and asserted in a test.
 */
function budgetControl({ lines = [], ledger = [], costing = null } = {}) {
  const breaches = budgetBreaches(lines, ledger);
  const claimed = round2(lines.reduce((s, l) => s + lineClaim(l), 0));
  const budgetTotal = round2(ledger.reduce((s, r) => s + Number(r.budget || 0), 0));
  const committed = round2(ledger.reduce((s, r) => s + Number(r.committed || 0), 0));
  const remaining = round2(budgetTotal - committed);
  return {
    costing_id: costing ? costing.costing_id : null,
    costing_doc_number: costing ? costing.doc_number || null : null,
    costing_status: costing ? costing.status : null,
    budget_total: budgetTotal,
    committed_elsewhere: committed,
    remaining_before: remaining,
    claimed_here: claimed,
    remaining_after: round2(remaining - claimed),
    // The two refusals a request can carry, named so a screen can render them
    // without re-deriving the rules.
    unbudgeted_line_count: lines.filter((l) => !l.costing_line_id).length,
    breaches,
    is_over_budget: breaches.length > 0,
  };
}

module.exports = {
  NEXT, assertTransition, sumField, computeTotals, assertMethod, disbursementState,
  lineClaim, budgetBreaches, apportionSettlement, budgetControl,
};
