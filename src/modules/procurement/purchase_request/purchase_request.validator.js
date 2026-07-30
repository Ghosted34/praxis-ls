"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({
    requested_by: z.string().uuid().optional().nullable(),
    department: z.string().optional(),
    justification: z.string().optional(),
    lines: z.array(z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), qty: z.number().nonnegative().optional(), unit_price: z.number().nonnegative().optional() })).optional(),
  }),
  transition: z.object({ to: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "ORDERED"]), entity_id: z.string().uuid().optional().nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), transition: mw("transition"), schemas };
