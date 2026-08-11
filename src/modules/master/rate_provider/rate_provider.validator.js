"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const KIND = z.enum(["SHIPPING_LINE", "AIRLINE", "PORT_AUTHORITY", "CUSTOMS_AUTHORITY", "OTHER"]);

const schemas = {
  create: z.object({
    kind: KIND,
    code: z.string().min(1).max(64),
    name: z.string().min(1),
    carrier_code: z.string().max(20).nullish(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  }),
  update: z.object({
    name: z.string().min(1).optional(),
    carrier_code: z.string().max(20).nullish(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
