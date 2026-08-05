"use strict";
/**
 * Journal-entry request validation.
 *
 * The schemas themselves now live in `packages/shared` and are imported by the
 * CLIENT as well, so there is one definition of a valid posting payload rather
 * than two that drift (audit F12). This file keeps the Express middleware; it
 * no longer owns the rules.
 *
 * ONLY THE SHAPE MOVED. The posting invariants — balanced, exactly one side per
 * line, at most two decimals — stay in `journal_entry.rules.js`, which now
 * delegates to `@praxis/shared`'s `ledger` module so the client can run the same
 * checks before it submits. They are deliberately NOT in the schema: each
 * carries its own API error code (`ENTRY_UNBALANCED`, `LINE_ONE_SIDE`, …) and a
 * `.refine()` would collapse five meanings into one `VALIDATION_ERROR`.
 *
 * Two intentional changes to what the endpoint accepts, both inherited from the
 * shared primitives and both consistent with the final-invoice move:
 *
 *   - `debit` / `credit` accept a numeric STRING as well as a number. Form
 *     inputs produce strings, and coercing at the schema boundary beats every
 *     call site remembering to `Number()` first (see `common.amount`).
 *   - `entry_date` is round-trip validated, so `2026-02-31` is now rejected.
 *     The old regex accepted it and `new Date()` rolled it over to 3 March —
 *     an entry posting silently to the wrong period.
 *
 * Add or change a rule in packages/shared and both sides move together.
 */
const { AppError } = require("../../../utils/errors");
const { journalEntry: schemas } = require("@praxis/shared");

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { post: mw("post"), reverse: mw("reverse"), schemas };
