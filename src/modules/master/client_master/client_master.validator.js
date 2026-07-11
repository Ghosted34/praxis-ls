"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const base = {
  entity_id: z.string().uuid().optional(),
  name: z.string().min(1),
  client_type_id: z.string().uuid().optional(),
  niu: z.string().optional(),
  rccm: z.string().optional(),
  payment_terms_days: z.number().int().min(0).optional(),
  credit_limit: z.number().nonnegative().optional(),
  kyc_docs: z.array(z.any()).optional(),
  is_withholding_agent: z.boolean().optional(),
};
const create = z.object(base);
const update = z.object({ ...base, name: z.string().min(1).optional(), is_active: z.boolean().optional() });
const schemas = { create, update };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { create: mw("create"), update: mw("update"), schemas };
