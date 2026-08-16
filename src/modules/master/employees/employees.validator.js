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
  // Department is a scope (0490): scope_id is the reference, department the
  // display snapshot the controller keeps in step with it.
  scope_id: z.string().uuid().optional().nullable(),
  // Line manager (0493). Cycles are rejected in the service, not here — the
  // check needs the tree.
  reports_to: z.string().uuid().optional().nullable(),
  department: z.string().max(120).optional(),
  job_title: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  employment_type: z.union([z.enum(EMPLOYMENT_TYPES), z.string().max(40)]).optional(),
  cnps_number: z.string().max(40).optional(),
  // Date service started (0696). Leave accrues per month of SERVICE, so the
  // accrual job has no anchor without it; the migration backfills it from
  // created_at and this is how a real start date replaces that proxy.
  hired_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD").optional().nullable(),
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
// AI-facing: employee_id in the payload → list_employees picker.
const aiUpdate = update.extend({ employee_id: z.string().uuid() });
const aiSetActive = setActive.extend({ employee_id: z.string().uuid() });

const schemas = { create, update, setActive, aiUpdate, aiSetActive };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { create: mw("create"), update: mw("update"), setActive: mw("setActive"), schemas, EMPLOYMENT_TYPES };
