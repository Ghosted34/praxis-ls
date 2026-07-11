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

const schemas = { createRun, compute, status };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { createRun: mw("createRun"), compute: mw("compute"), status: mw("status"), schemas };
