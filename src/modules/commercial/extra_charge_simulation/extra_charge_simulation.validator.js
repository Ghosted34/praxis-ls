"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const tier = z.object({ from_day: z.number().int().positive(), to_day: z.number().int().positive().nullable().optional(), rate: z.number().nonnegative() });

// G16 — the five-family simulator inputs (container list + dates + rates).
const container = z.object({
  q: z.number().int().positive().default(1),
  s: z.number().int().positive().default(20),
  t: z.string().regex(/^(DC|RF|HC|FR)$/).default("DC"),
});

const schemas = {
  compute: z.object({
    dossier_id: z.string().uuid().optional().nullable(),
    shipping_line: z.string().optional(),
    container_variant: z.string().optional(),
    // G16 — full model: a container list, the three dates, and optional rates.
    containers: z.union([z.string().min(1), z.array(container)]).optional(),
    ata: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    gate_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    empty_return: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    yard_trigger: z.number().int().positive().optional(),
    rates: z.record(z.string(), z.any()).optional(),
    fx: z.record(z.string(), z.number()).optional(),
    free_days: z.number().int().nonnegative().optional(),
    occupied_days: z.number().int().nonnegative().optional(),
    out_of_port_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    currency: z.string().length(3).optional(),
    tiers: z.array(tier).optional(),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { compute: mw("compute"), schemas };
