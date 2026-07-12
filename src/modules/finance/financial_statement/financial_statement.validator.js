"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const query = z.object({
  account: z.string().optional(),
  entity_id: z.string().uuid().optional(),
  period_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const mw = (req, _res, next) => {
  const p = query.safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};

const closePeriod = z.object({
  period_id: z.string().uuid(),
  to: z.enum(["FROZEN", "CLOSED"]).optional(),
});
const closeMw = (req, _res, next) => {
  const p = closePeriod.safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.validatedBody = p.data;
  return next();
};

module.exports = { query: mw, closePeriod: closeMw, schemas: { query, closePeriod } };
