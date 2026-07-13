"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ entity_id: z.string().uuid(), kind: z.enum(["BANK", "CASH", "MOMO"]), label: z.string().min(1), coa_code: z.string().min(1), momo_network: z.string().optional().nullable(), momo_fee_account: z.string().optional().nullable(), currency: z.string().length(3).optional() }),
  update: z.object({ label: z.string().optional(), currency: z.string().length(3).optional(), coa_code: z.string().optional(), momo_network: z.string().optional().nullable(), momo_fee_account: z.string().optional().nullable() }),
  setActive: z.object({ active: z.boolean() }),
  gatewayUpsert: z.object({
    provider: z.string().min(1).max(64),
    active: z.boolean().optional(),
    role: z.string().max(64).optional().nullable(),
    credentials: z.union([z.string().min(1).max(8000), z.record(z.any())]).optional(),
  }),
  gatewayActive: z.object({ active: z.boolean() }),
  gatewayRole: z.object({ role: z.string().min(1).max(64) }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = {
  create: mw("create"), update: mw("update"), setActive: mw("setActive"),
  gatewayUpsert: mw("gatewayUpsert"), gatewayActive: mw("gatewayActive"), gatewayRole: mw("gatewayRole"),
  schemas,
};
