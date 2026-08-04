"use strict";
/**
 * Final-invoice request validation.
 *
 * The schemas themselves now live in `packages/shared` and are imported by the
 * CLIENT as well, so there is one definition of a valid invoice payload rather
 * than two that drift (audit F12: the client re-implemented these rules as
 * ad-hoc booleans, e.g. `finance/pages.tsx:141`'s `canSubmit`). This file keeps
 * the Express middleware; it no longer owns the rules.
 *
 * Add or change a rule in packages/shared/schemas/final-invoice.js and both
 * sides move together.
 */
const { AppError } = require("../../../utils/errors");
const { finalInvoice: schemas } = require("@praxis/shared");

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { createDraft: mw("createDraft"), updateDraft: mw("updateDraft"), submit: mw("submit"), schemas };
