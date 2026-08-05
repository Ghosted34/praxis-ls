"use strict";
/**
 * Client-master request validation.
 *
 * The schemas themselves now live in `packages/shared` and are imported by the
 * CLIENT as well, so there is one definition of a valid client payload rather
 * than two that drift (audit F12). This file keeps the Express middleware; it
 * no longer owns the rules.
 *
 * One intentional change to what the endpoint stores. Every optional text field
 * used to be `z.string().optional().or(z.literal(""))`, which ACCEPTS a form's
 * `""` and writes it — so `email` landed as `''` rather than NULL and
 * `WHERE email IS NULL` missed the rows a human would call "no email". The
 * shared schema normalises `""` to `undefined` instead. Existing rows are
 * untouched; new writes stop adding to the problem.
 *
 * Add or change a rule in packages/shared/schemas/client-master.js and both
 * sides move together.
 */
const { AppError } = require("../../../utils/errors");
const { clientMaster: schemas } = require("@praxis/shared");

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
