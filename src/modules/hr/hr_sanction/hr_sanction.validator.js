"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  employee_id: z.string().uuid(),
  hr_query_id: z.string().uuid().optional().nullable(),
  type: z.enum(["WARNING", "SUSPENSION", "DEMOTION", "FINE", "DISMISSAL"]),
  reason: z.string().min(1).max(5000),
  amount_xaf: z.number().nonnegative().optional().nullable(),
  effective_date: z.string().optional(),
  end_date: z.string().optional().nullable(),
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
