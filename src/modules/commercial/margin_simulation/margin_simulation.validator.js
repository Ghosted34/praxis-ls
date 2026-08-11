"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const line = z.object({
  dictionary_item_id: z.string().uuid().optional().nullable(),
  label: z.string().optional(),
  qty: z.number().positive().optional(),
  unit_cost: z.number().nonnegative().optional(),
  unit_price: z.number().nonnegative().optional(),
  is_disbursement: z.boolean().optional(),
});

const schemas = {
  compute: z.object({
    dossier_id: z.string().uuid().optional().nullable(),
    service_type_id: z.string().uuid().optional().nullable(),
    currency: z.string().length(3).optional(),
    lines: z.array(line).min(1),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { compute: mw("compute"), schemas };
