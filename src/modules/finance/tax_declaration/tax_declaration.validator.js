"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const query = z.object({
  entity_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_code: z.string().regex(/^\d{4}(-\d{2})?$/).optional(),
});
const mw = (req, _res, next) => {
  const p = query.safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};
module.exports = { query: mw, schemas: { query } };
