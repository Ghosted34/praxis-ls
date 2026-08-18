"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const UUID = z.string().uuid();

const schemas = {
  create: z.object({ dossier_id: UUID }),
  idParam: z.object({ id: UUID }),
  reject: z.object({
    id: UUID,
    reason: z.string().trim().min(3).max(2000),
  }),
};

const mw = (k, fromParams = false) => (req, _res, next) => {
  const source = fromParams ? req.params : { ...req.body, ...req.params };
  const p = schemas[k].safeParse(source);
  if (!p.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  }
  if (fromParams) req.params = p.data;
  else req.body = { ...req.body, ...p.data };
  return next();
};

module.exports = {
  create: mw("create"),
  idParam: mw("idParam", true),
  reject: mw("reject"),
};
