/** Auditor data-room request validation (zod, matching portal_auth.validator). */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const UUID = z.string().uuid();

const schemas = {
  create: z.object({
    note: z.string().trim().min(1).max(2000),
  }),
  id: z.object({ id: UUID }),
  attach: z.object({ id: UUID, doc_id: UUID }),
  idDoc: z.object({ id: UUID, docId: UUID }),
};

const mw = (k, fromParams = false) => (req, _res, next) => {
  const source = fromParams ? req.params : { ...req.body, ...req.params };
  const p = schemas[k].safeParse(source);
  if (!p.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid data room request", 422, p.error.flatten().fieldErrors));
  }
  if (fromParams) req.params = p.data;
  else req.body = { ...req.body, ...p.data };
  return next();
};

module.exports = {
  create: mw("create"),
  id: mw("id", true),
  attach: mw("attach"),
  idDoc: mw("idDoc", true),
};
