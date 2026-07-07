"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({
  full_name: z.string().min(2),
  entity_id: z.string().uuid().optional(),
  department: z.string().optional(), job_title: z.string().optional(),
  employment_type: z.string().optional(), cnps_number: z.string().optional(),
  base_salary: z.number().nonnegative().optional(),
  risk_class_rate: z.number().optional(),
  signatory_name: z.string().optional(), is_driver: z.boolean().optional(),
});
const schemas = { create, update: create.partial() };
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
