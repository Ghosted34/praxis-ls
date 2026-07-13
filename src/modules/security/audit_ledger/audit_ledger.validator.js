"use strict";
// The ledger itself has no write path; these validate the access-review workflow
// (4.1) bodies. CRUD create/update stay passthrough (no HTTP writes to the ledger).
const { z } = require("zod");
const { passthrough } = require("../../../shared/http/validate");
const { AppError } = require("../../../utils/errors");

const schemas = {
  reviewCreate: z.object({ name: z.string().min(1).max(200) }),
  entryDecision: z.object({
    decision: z.enum(["approved", "revoked", "flagged"]),
    note: z.string().max(2000).optional().nullable(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { ...passthrough, reviewCreate: mw("reviewCreate"), entryDecision: mw("entryDecision"), schemas };
