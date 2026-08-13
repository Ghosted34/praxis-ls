"use strict";
/**
 * The ledger's posting invariants, as pure functions.
 *
 * ── WHY THIS IS NOT A ZOD SCHEMA ──────────────────────────────────────────────
 *
 * The obvious move, migrating forms to shared Zod schemas, is to put every rule
 * in the schema. It is the wrong move here, and the reason is worth stating
 * because it generalises.
 *
 * A Zod schema answers "is this payload the right SHAPE". These are DOMAIN
 * invariants, and the API distinguishes them by error code — `ENTRY_UNBALANCED`,
 * `LINE_ONE_SIDE`, `LINE_NO_ACCOUNT`, `ENTRY_TOO_FEW_LINES`, `INVALID_AMOUNT`.
 * Four test files assert those codes, the AI tool surface branches on them, and
 * an operator reading "Entry not balanced: debit 500 <> credit 450" is being
 * told something a generic `VALIDATION_ERROR` cannot say. Folding them into a
 * `.refine()` would collapse five meanings into one and break the tests that
 * exist precisely to protect them.
 *
 * So: shape goes in `schemas/`, invariants go here. Both are shared; they are
 * shared as different KINDS of thing.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
 *
 * `client/src/features/finance/journals.tsx` computed its own answer:
 *
 *     const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;
 *     const linesValid = lines.every((l) => l.account_code && (num(l.debit) > 0 || num(l.credit) > 0));
 *
 * That is audit F12's "client re-implements validation as ad-hoc booleans", and
 * it was not merely duplicated — it was WRONG in two ways the user feels:
 *
 *   1. `(debit > 0 || credit > 0)` accepts a line with BOTH sides filled. The
 *      ledger requires exactly one (#23.2). The form said "Balanced", the user
 *      pressed Post, and the server returned LINE_ONE_SIDE.
 *   2. Nothing checked the 2-decimal limit, so `33.333` passed the form and came
 *      back INVALID_AMOUNT.
 *
 * In both cases the form asserted the entry was postable and the server refused
 * it. A form that lies about what will be accepted is worse than one that says
 * nothing.
 *
 * ── THE RETURN SHAPE ─────────────────────────────────────────────────────────
 *
 * Results, not exceptions. The API wraps them in `AppError` and keeps every
 * code; the client renders `message` next to `line`. A throwing API would have
 * forced the client to try/catch a synchronous validator on every keystroke.
 *
 * Minor units throughout: `0.1 + 0.2 !== 0.3`, and a ledger that compares
 * floating-point totals is a ledger that will one day refuse a balanced entry.
 */

/** @typedef {{ ok: true }} Ok */
/** @typedef {{ ok: false, code: string, message: string, line?: number }} Fail */

/**
 * Convert a decimal amount to integer minor units (centimes).
 * Returns `null` when the value has more than 2 decimals — the caller decides
 * what that means, because the API and the client word it differently.
 */
function toMinor(value) {
  const v = Number(value || 0);
  if (!Number.isFinite(v)) return null;
  const minor = Math.round(v * 100);
  // 1e-6 rather than an exact compare: 33.33 * 100 is 3332.9999999999995.
  if (Math.abs(v * 100 - minor) > 1e-6) return null;
  return minor;
}

/**
 * Check one proposed line. `index` is zero-based; messages are one-based,
 * because "line 1" is what the operator sees.
 *
 * @returns {Ok | Fail}
 */
function checkLine(line, index) {
  const at = index + 1;
  if (
    !line ||
    typeof line.account_code !== "string" ||
    !line.account_code.trim()
  ) {
    return {
      ok: false,
      code: "LINE_NO_ACCOUNT",
      message: `Line ${at}: choose an account.`,
      line: index,
    };
  }
  const d = toMinor(line.debit);
  const c = toMinor(line.credit);
  if (d === null || c === null) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: `Line ${at}: at most 2 decimal places.`,
      line: index,
    };
  }
  if (d < 0 || c < 0) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: `Line ${at}: amounts cannot be negative.`,
      line: index,
    };
  }
  // #23.2 — exactly one side. The old client boolean was `d > 0 || c > 0`,
  // which accepts a line with both filled and is the defect above.
  if (d > 0 === c > 0) {
    return {
      ok: false,
      code: "LINE_ONE_SIDE",
      message: `Line ${at}: enter a debit OR a credit, not both.`,
      line: index,
    };
  }
  return { ok: true };
}

/**
 * Check a whole set of proposed lines against the posting invariants.
 *
 * Order matters and is deliberate: too-few-lines, then each line in turn, then
 * the balance. It reports the FIRST problem, because an operator fixes one
 * thing at a time and a wall of five messages about the same mistyped number is
 * noise.
 *
 * @returns {Ok | Fail}
 */
function checkEntry(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return {
      ok: false,
      code: "ENTRY_TOO_FEW_LINES",
      message: "A journal entry needs at least two lines.",
    };
  }
  let debitMinor = 0;
  let creditMinor = 0;
  for (let i = 0; i < lines.length; i++) {
    const r = checkLine(lines[i], i);
    if (!r.ok) return r;
    debitMinor += toMinor(lines[i].debit) || 0;
    creditMinor += toMinor(lines[i].credit) || 0;
  }
  // #23.1 — balanced.
  if (debitMinor !== creditMinor) {
    return {
      ok: false,
      code: "ENTRY_UNBALANCED",
      message: `Out of balance by ${Math.abs(debitMinor - creditMinor) / 100}. Debit ${debitMinor / 100}, credit ${creditMinor / 100}.`,
    };
  }
  return { ok: true };
}

/**
 * #23.6 — no compensation. An account may not be both debited and credited
 * within one entry; post the net line instead.
 *
 * Structural line-level netting is already blocked by `checkLine`'s one-side
 * rule; this catches the same account offsetting ACROSS lines, which looks
 * balanced and is not permitted.
 *
 * @returns {Ok | Fail}
 */
function checkNoCompensation(lines) {
  const debited = new Set();
  const credited = new Set();
  for (const ln of Array.isArray(lines) ? lines : []) {
    const acc = String((ln && ln.account_code) || "").trim();
    if (!acc) continue;
    if (Number(ln.debit) > 0) debited.add(acc);
    if (Number(ln.credit) > 0) credited.add(acc);
  }
  for (const acc of debited) {
    if (credited.has(acc)) {
      return {
        ok: false,
        code: "COMPENSATION",
        message: `Account ${acc} is both debited and credited — post the net amount instead.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Every invariant, in the order the API applies them. This is what a form
 * should call: one answer, the first problem, ready to render.
 *
 * @returns {Ok | Fail}
 */
function checkPostable(lines) {
  const entry = checkEntry(lines);
  if (!entry.ok) return entry;
  return checkNoCompensation(lines);
}

/** Totals in minor units, for a form that wants to display them. */
function totals(lines) {
  let debitMinor = 0;
  let creditMinor = 0;
  for (const l of Array.isArray(lines) ? lines : []) {
    debitMinor += toMinor(l && l.debit) || 0;
    creditMinor += toMinor(l && l.credit) || 0;
  }
  return { debitMinor, creditMinor };
}

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js
// for why the object-literal form is invisible to cjs-module-lexer.
exports.toMinor = toMinor;
exports.checkLine = checkLine;
exports.checkEntry = checkEntry;
exports.checkNoCompensation = checkNoCompensation;
exports.checkPostable = checkPostable;
exports.totals = totals;
