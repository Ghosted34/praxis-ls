/** Asset (MOD-54) Zod validators. */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  entity_id: z.string().uuid(),
  label: z.string().min(1),
  tag: z.string().optional(),
  coa_asset_code: z.string().optional(),
  coa_depr_code: z.string().optional(),
  acquisition_cost: z.number().positive(),
  residual_value: z.number().nonnegative().optional(),
  method: z.enum(["LINEAR", "DECLINING"]).optional(),
  useful_life_months: z.number().int().positive(),
  acquired_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "acquired_on must be YYYY-MM-DD"),
});
const update = z.object({
  label: z.string().min(1).optional(),
  tag: z.string().optional(),
  coa_asset_code: z.string().optional(),
  coa_depr_code: z.string().optional(),
});
const depreciate = z.object({ period_code: z.string().regex(/^\d{4}-\d{2}$/, "period_code must be YYYY-MM") });
const dispose = z.object({
  disposed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  proceeds: z.number().nonnegative().optional(),
});

const schemas = { create, update, depreciate, dispose };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { create: mw("create"), update: mw("update"), depreciate: mw("depreciate"), dispose: mw("dispose"), schemas };
