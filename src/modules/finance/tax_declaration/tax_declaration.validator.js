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

const KINDS = ["TVA", "IS", "MIN_TAX", "WHT", "DSF", "CNPS", "DIPE", "PATENTE"];
const bodySchemas = {
  file: z.object({
    entity_id: z.string().uuid().optional(),
    kind: z.enum(KINDS),
    period_code: z.string().regex(/^\d{4}(-\d{2})?$/),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  submit: z.object({ filed_ref: z.string().max(120).optional().nullable() }),
};
const bodyMw = (k) => (req, _res, next) => {
  const p = bodySchemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { query: mw, file: bodyMw("file"), submit: bodyMw("submit"), schemas: { query, ...bodySchemas } };
