"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  compute: z.object({
    dossier_id: z.string().uuid(),
    quotation_id: z.string().uuid().optional().nullable(),
    costing_id: z.string().uuid().optional().nullable(),
    margin_simulation_id: z.string().uuid().optional().nullable(),
    quoted_price: z.number().nonnegative().optional().nullable(),
    actual_cost: z.number().nonnegative().optional().nullable(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { compute: mw("compute"), schemas };
