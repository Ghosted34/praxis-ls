"use strict";
/**
 * Supplier-master request validation.
 *
 * The schema now lives in `packages/shared/schemas/supplier-master.js` and is
 * imported by the CLIENT as well, so there is one definition of a valid supplier
 * payload rather than an inline one here that drifts from the client's copy
 * (audit F12 — the same move already made for client_master). This file keeps
 * the Express middleware; it no longer owns the rules.
 *
 * Add or change a rule in packages/shared/schemas/supplier-master.js and both
 * sides move together.
 */
const { AppError } = require("../../../utils/errors");
const { supplierMaster: schemas } = require("@praxis/shared");

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
