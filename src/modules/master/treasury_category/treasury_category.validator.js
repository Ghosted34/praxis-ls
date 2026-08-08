"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: z.object({
    code: z.string().min(2).max(64),
    label: z.string().min(1).max(200),
    legacy_kind: z.enum(["BANK", "CASH", "MOMO"]),
    coa_parent_code: z.string().min(1).max(64),
    requires_custodian: z.boolean().optional(),
    is_bank_identity: z.boolean().optional(),
    is_momo_identity: z.boolean().optional(),
  }),
  update: z.object({
    code: z.string().min(2).max(64).optional(),
    label: z.string().min(1).max(200).optional(),
    coa_parent_code: z.string().min(1).max(64).optional(),
    requires_custodian: z.boolean().optional(),
    is_bank_identity: z.boolean().optional(),
    is_momo_identity: z.boolean().optional(),
  }),
  setActive: z.object({ active: z.boolean() }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"), update: mw("update"), setActive: mw("setActive"), schemas,
};
