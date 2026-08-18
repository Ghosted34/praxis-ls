/**
 * Régie d'avance decision logic (KB §6.8) — pure, no DB.
 *
 * An advance sits validly in 581. It is NEVER auto-allocated to 4731. Past its
 * policy window, if still unjustified, the OPEN balance reclassifies 581 -> 4211
 * (a receivable from the holder). This module decides "is it aged?", "how much
 * is open?" and "what state does that put it in?"; the postings go through the
 * ledger engine.
 *
 * WHY A TRANSITION TABLE NOW. Before 10717 there was none, and `ageOne` wrote
 * `state: "AGED_UNJUSTIFIED"` directly with no guard. That is how three of the
 * five states in the DB CHECK (0230:29) became unreachable — nothing else ever
 * wrote `state` at all.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

const num = (v) => Number(v || 0);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The lifecycle, as data — so the service, the routes, the AI manifest and the
 * client all read ONE source rather than each re-deriving it.
 *
 * Two edges here are deliberate and are NOT in the KB's prose:
 *
 *   AGED_UNJUSTIFIED is not terminal. A holder who produces receipts a week
 *   late must still be able to retire the advance. Without the back-edge, aging
 *   is a one-way door: the balance sits in 4211 and a later receipt cannot post
 *   against 581 because 581 is already flat. That is precisely the costing
 *   APPROVED_LOCKED defect (a lock with no key), and repeating it in a module
 *   written from scratch would be indefensible.
 *
 *   QUERIED exits both ways. KB §6.8 step 5 says "write off to 658 OR recover
 *   from the holder", so a query is a hold, not a verdict.
 */
const NEXT = {
  ISSUED: ["PARTIALLY_JUSTIFIED", "JUSTIFIED", "AGED_UNJUSTIFIED", "QUERIED"],
  PARTIALLY_JUSTIFIED: ["JUSTIFIED", "AGED_UNJUSTIFIED", "QUERIED"],
  AGED_UNJUSTIFIED: ["ISSUED", "PARTIALLY_JUSTIFIED", "JUSTIFIED", "QUERIED"],
  QUERIED: ["PARTIALLY_JUSTIFIED", "JUSTIFIED"],
  JUSTIFIED: [],
};

/** The three ways an advance can be retired, and which account each debits. */
const RETIREMENT_KINDS = ["RECEIPT", "CASH_RETURN", "WRITE_OFF"];

/** Which settings account key each kind debits. Credit is always the régie account. */
const DEBIT_ACCOUNT_FOR = {
  RECEIPT: "dossier_mandant", // 4731, per dossier — KB step 2
  CASH_RETURN: "cash", // 571                — KB step 3
  WRITE_OFF: "write_off", // 658                — KB step 5
};

function assertTransition(from, to) {
  if (from === to) return true; // a recompute that lands where it started is a no-op, not an error
  if (!NEXT[from] || !NEXT[from].includes(to)) {
    throw new AppError("BAD_STATE", `Cannot move régie advance ${from} -> ${to}`, 422);
  }
  return true;
}

/** Open (unjustified, unreturned) balance still sitting in 581. */
function openBalance(advance) {
  return round2(num(advance.amount) - num(advance.justified_amount) - num(advance.returned_amount));
}

/**
 * Split a set of retirement rows into the two totals `regie_advance` caches.
 *
 * RECEIPT is "justified" (it became a real 4731 cost). CASH_RETURN and WRITE_OFF
 * are "returned" — the money came back or was given up on; neither is a
 * justification of spend. Both are subtracted from the open balance, which is
 * what makes 581 net to zero in every closing path.
 */
function totalsFrom(retirements) {
  let justified = 0;
  let returned = 0;
  for (const r of retirements || []) {
    const amt = num(r.amount);
    if (r.kind === "RECEIPT") justified += amt;
    else returned += amt;
  }
  return { justified_amount: round2(justified), returned_amount: round2(returned) };
}

/**
 * What state does an advance with these totals sit in?
 *
 * Pure: takes the advance and its recomputed totals, returns the next state.
 * Never consults the clock — aging is time-driven and is `isAged`'s job.
 *
 * The `QUERIED` guard is the subtle one. A query is a human hold placed on an
 * advance; a subsequent partial receipt must not silently lift it, or the hold
 * means nothing. So a QUERIED advance stays QUERIED until it is fully resolved
 * (open === 0), at which point there is nothing left to hold.
 */
function recomputeState(advance, totals) {
  const amount = num(advance.amount);
  const consumed = round2(num(totals.justified_amount) + num(totals.returned_amount));
  const open = round2(amount - consumed);

  if (open < 0) {
    throw new AppError(
      "OVER_RETIRED",
      `Retirements total ${consumed} against an advance of ${amount} — ${round2(-open)} more than was issued`,
      422,
    );
  }
  if (open === 0) return "JUSTIFIED";
  // Still open. A hold survives a partial retirement; see the note above.
  if (advance.state === "QUERIED") return "QUERIED";
  if (advance.state === "AGED_UNJUSTIFIED") {
    // A late receipt against an aged advance: it is being justified again, but
    // the money is in 4211 until unage() moves it back, so it must not silently
    // claim to be a normal partial. Caller decides; state is unchanged here.
    return "AGED_UNJUSTIFIED";
  }
  return consumed > 0 ? "PARTIALLY_JUSTIFIED" : "ISSUED";
}

function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00Z").getTime();
  const b = new Date(toISO + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86400000);
}

/** Aged when past the policy window, still open, and not already closed/aged/queried. */
function isAged(advance, todayISO) {
  const stillOpen = openBalance(advance) > 0;
  const agingState = advance.state === "ISSUED" || advance.state === "PARTIALLY_JUSTIFIED";
  const pastWindow = daysBetween(advance.issued_on, todayISO) > num(advance.policy_window_days);
  return stillOpen && agingState && pastWindow;
}

/**
 * Days until this advance's window closes — negative once it is overdue.
 * Uses the ROW's own policy_window_days, never a global constant: the window is
 * defaulted from settings at issue and then frozen on the advance, so changing
 * the tenant default must not retroactively age advances already in flight.
 */
function daysToWindow(advance, todayISO) {
  return num(advance.policy_window_days) - daysBetween(advance.issued_on, todayISO);
}

/** Watchlist: open, not yet aged, and inside `warnDays` of its window closing. */
function isDueSoon(advance, todayISO, warnDays = 2) {
  if (openBalance(advance) <= 0) return false;
  if (advance.state !== "ISSUED" && advance.state !== "PARTIALLY_JUSTIFIED") return false;
  const left = daysToWindow(advance, todayISO);
  return left >= 0 && left <= num(warnDays);
}

/**
 * Guard a proposed retirement before anything is written.
 *
 * `0497_money_constraints.sql:137` already enforces
 * `justified_amount + returned_amount <= amount`, so over-retirement is refused
 * by the database regardless. Checking here turns a raw constraint violation
 * surfacing from inside a transaction into a 422 that names the overage.
 */
function assertRetirable(advance, { kind, amount, dossierId, proofVaultId }, opts = {}) {
  const { requireProofForReceipt = true } = opts;

  if (!RETIREMENT_KINDS.includes(kind)) {
    throw new AppError("BAD_KIND", `kind must be one of ${RETIREMENT_KINDS.join(", ")}`, 422);
  }
  if (!(num(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);

  if (advance.state === "JUSTIFIED") {
    throw new AppError("ALREADY_CLOSED", "This advance is fully justified and closed", 422);
  }
  if (kind === "WRITE_OFF" && advance.state !== "QUERIED") {
    // KB §6.8 step 5 writes off only what was first held as a query. Writing off
    // straight from ISSUED would skip the human decision the query represents.
    throw new AppError(
      "NOT_QUERIED",
      "An advance must be queried before it can be written off (KB §6.8 step 5)",
      422,
    );
  }
  if (kind === "RECEIPT" && !dossierId) {
    // 4731 is requires_analytic (9001:113) so the ledger trigger would refuse a
    // NULL dossier anyway; this is the readable error instead of a raw RAISE.
    throw new AppError("DOSSIER_REQUIRED", "A receipt must be tagged to a dossier", 422);
  }
  if (kind === "RECEIPT" && requireProofForReceipt && !proofVaultId) {
    throw new AppError(
      "PROOF_REQUIRED",
      "Never invent a 4731 line without a document (KB §6.8 step 5) — attach the receipt or hold the advance as a query",
      422,
    );
  }

  const open = openBalance(advance);
  if (num(amount) > open) {
    throw new AppError(
      "OVER_RETIRED",
      `Cannot retire ${num(amount)} against an open balance of ${open}`,
      422,
    );
  }
  return true;
}

/**
 * The posting for one retirement: Dr <per kind> / Cr <régie>.
 *
 * Returned as data so it can be asserted balanced in a unit test with no DB.
 * The SHAPE is deliberately not configurable — which accounts are used is a
 * tenant setting, but that a retirement is one debit, one credit, and balances
 * is not something a tenant may reconfigure into an unbalanced entry.
 */
function retirementLines({ kind, amount, dossierId }, accounts) {
  const debitKey = DEBIT_ACCOUNT_FOR[kind];
  if (!debitKey) throw new AppError("BAD_KIND", `Unknown retirement kind ${kind}`, 422);
  const debitAccount = accounts[debitKey];
  if (!debitAccount) throw new AppError("NO_ACCOUNT", `No account configured for ${debitKey}`, 500);

  const line = { account_code: debitAccount, debit: round2(num(amount)), credit: 0 };
  // Only the 4731 leg is analytical. Attaching a dossier to a 571 or 658 line
  // would be noise at best; the trigger only demands it where requires_analytic.
  if (kind === "RECEIPT") line.dossier_id = dossierId;

  return [line, { account_code: accounts.regie, debit: 0, credit: round2(num(amount)) }];
}

module.exports = {
  NEXT,
  RETIREMENT_KINDS,
  DEBIT_ACCOUNT_FOR,
  assertTransition,
  openBalance,
  totalsFrom,
  recomputeState,
  isAged,
  isDueSoon,
  daysBetween,
  daysToWindow,
  assertRetirable,
  retirementLines,
};
