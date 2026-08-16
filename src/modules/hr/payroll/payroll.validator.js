/** Payroll (MOD-17) Zod validators. */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const createRun = z.object({
  entity_id: z.string().uuid(),
  period_code: z.string().regex(/^\d{4}-\d{2}$/, "period_code must be YYYY-MM"),
});
const compute = z.object({ config: z.record(z.string(), z.any()).optional() });
const status = z.object({
  status: z.enum(["OPEN", "COMPUTED", "SUBMITTED", "APPROVED", "VALIDATED", "DISBURSED", "REJECTED"]),
});

/* ── Salary advances (0698) ────────────────────────────────────────────────
 *
 * `instalment_amount` is optional and derived from amount ÷ instalments when
 * omitted: an employer agreeing "300,000 over three months" should not have to
 * do the division. The service refuses a schedule whose instalments cannot
 * reach the amount — a plan that never finishes is worse than no plan.
 */
const advance = z.object({
  employee_id: z.string().uuid(),
  entity_id: z.string().uuid().optional(),
  leave_request_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  instalments: z.number().int().min(1).max(60).optional(),
  instalment_amount: z.number().positive().optional(),
  first_period_code: z.string().regex(/^\d{4}-\d{2}$/, "first_period_code must be YYYY-MM"),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  note: z.string().max(1000).optional(),
});
const advanceUpdate = z.object({
  instalments: z.number().int().min(1).max(60).optional(),
  instalment_amount: z.number().positive().optional(),
  first_period_code: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  // SETTLED is absent on purpose: a plan settles when it is fully recovered,
  // not because somebody said so. Writing one off is the deliberate act.
  status: z.enum(["ACTIVE", "SUSPENDED", "WRITTEN_OFF"]).optional(),
  note: z.string().max(1000).optional(),
});

// AI-facing: payroll_run_id in the payload → list_payroll_runs picker.
const aiStatus = status.extend({ payroll_run_id: z.string().uuid() });
const schemas = { createRun, compute, status, aiStatus, advance, advanceUpdate };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = {
  createRun: mw("createRun"),
  compute: mw("compute"),
  status: mw("status"),
  advance: mw("advance"),
  advanceUpdate: mw("advanceUpdate"),
  schemas,
};
