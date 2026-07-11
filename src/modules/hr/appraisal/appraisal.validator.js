"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  kpi_target_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  period_code: z.string().min(1),
  actual_value: z.number().optional(),
  rating: z.number().optional(),
  comments: z.string().optional(),
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
