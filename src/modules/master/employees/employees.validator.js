/** Employee master (MOD-02) Zod validators — full column coverage. */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

// Cameroon/OHADA employment categories (soft enum: unknown strings still allowed
// so a tenant isn't blocked, but the common set is documented for the UI/AI).
const EMPLOYMENT_TYPES = ["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"];

const base = {
  entity_id: z.string().uuid().optional(),
  full_name: z.string().min(2),
  department: z.string().max(120).optional(),
  job_title: z.string().max(120).optional(),
  employment_type: z.union([z.enum(EMPLOYMENT_TYPES), z.string().max(40)]).optional(),
  cnps_number: z.string().max(40).optional(),
  base_salary: z.number().nonnegative().optional(),
  risk_class_rate: z.number().min(0).max(1).optional(),
  bank_block: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  signatory_name: z.string().max(160).optional(),
  avatar_ref: z.string().max(400).optional(),
  is_driver: z.boolean().optional(),
};

const create = z.object(base);
const update = z.object({ ...base, full_name: z.string().min(2).optional(), is_active: z.boolean().optional() });
const setActive = z.object({ is_active: z.boolean() });

const schemas = { create, update, setActive };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { create: mw("create"), update: mw("update"), setActive: mw("setActive"), schemas, EMPLOYMENT_TYPES };
