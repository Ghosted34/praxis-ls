/**
 * Pure, DB-free posting rules — the friendly pre-checks that mirror the KB §23
 * invariants the database also enforces via triggers. We check here first so the
 * caller gets a clear 422 (which line, why) instead of a raw Postgres error, and
 * so the rules are unit-testable without a database.
 *
 * The database remains the source of truth: even if this passed by mistake, the
 * triggers in migrations/tenant/0220_ledger.sql would still reject a bad write.
 *
 * ── THE LOGIC NOW LIVES IN packages/shared ───────────────────────────────────
 *
 * This file is the Express-side ADAPTER: it calls `@praxis/shared`'s ledger
 * rules and turns their result into the `AppError` codes the API has always
 * returned. Every code is preserved — `ENTRY_TOO_FEW_LINES`, `LINE_NO_ACCOUNT`,
 * `INVALID_AMOUNT`, `LINE_ONE_SIDE`, `ENTRY_UNBALANCED`, `COMPENSATION` — because
 * the AI tool surface branches on them and four test files assert them.
 *
 * WHY MOVE THEM AT ALL. The client had its own copy, and it was wrong (audit
 * F12). `journals.tsx` computed `linesValid` as `account_code && (debit > 0 ||
 * credit > 0)`, which ACCEPTS a line with both sides filled — the ledger requires
 * exactly one. It also never checked the two-decimal limit. So the form would
 * report "Balanced", the user pressed Post, and the server returned LINE_ONE_SIDE
 * or INVALID_AMOUNT. A form that asserts an entry is postable and is then
 * refused is worse than one that says nothing.
 *
 * WHY THEY ARE NOT A ZOD SCHEMA. See packages/shared/rules/ledger.js — in short,
 * a `.refine()` would collapse six distinct error codes into `VALIDATION_ERROR`.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { ledger } = require("@praxis/shared");

/** Turn a shared-rules result into the AppError this API has always thrown. */
function raise(result) {
  if (!result.ok) throw new AppError(result.code, result.message, 422);
}

// Work in integer minor units (centimes) to avoid float drift when summing money.
// Kept as a named export because `ledger-rules.test.js` exercises it directly.
function toMinor(v, label) {
  const minor = ledger.toMinor(v);
  if (minor === null || typeof v !== "number" || v < 0) {
    throw new AppError("INVALID_AMOUNT", `${label} must be a non-negative number with at most 2 decimals`, 422);
  }
  return minor;
}

/**
 * Validate a set of proposed journal lines. Returns { debitMinor, creditMinor }
 * on success; throws AppError(422) otherwise.
 *   #1 balanced · #2 exactly one side > 0 per line · ≥2 lines · postable code shape.
 * (Account existence / postable-leaf / débours-class / dossier-required are DB
 * concerns — enforced by triggers, not guessable here without the COA.)
 */
function assertBalanced(lines) {
  raise(ledger.checkEntry(lines));
  return ledger.totals(lines);
}

/**
 * #23.6 no compensation — an account may not be both debited and credited within
 * one entry (post the net line instead). Structural line-level netting is already
 * blocked by the one-side CHECK; this catches same-account offsetting across lines.
 */
function assertNoCompensation(lines) {
  raise(ledger.checkNoCompensation(lines));
}

module.exports = { assertBalanced, assertNoCompensation, toMinor };
