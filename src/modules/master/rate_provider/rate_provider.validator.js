"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

// TRUCKING/RAIL/BARGE/COURIER joined at 0664: a subcontracted haul is the case
// where the rate card matters most, and the old list had nowhere to put one.
// Must stay in step with `chk_rate_provider_kind` — a kind accepted here and
// refused by the CHECK is a 500 on save.
const KIND = z.enum([
  "SHIPPING_LINE", "AIRLINE", "TRUCKING", "RAIL",
  "BARGE", "COURIER", "PORT_AUTHORITY", "CUSTOMS_AUTHORITY", "OTHER",
]);

// ISO 3166-1 alpha-2, stored as typed. Optional: plenty of small hauliers are
// added mid-booking by someone who knows the name and nothing else.
const COUNTRY = z.string().length(2).regex(/^[A-Za-z]{2}$/, "must be a 2-letter country code")
  .transform((s) => s.toUpperCase()).nullish();

const schemas = {
  create: z.object({
    kind: KIND,
    code: z.string().min(1).max(64),
    name: z.string().min(1),
    carrier_code: z.string().max(20).nullish(),
    country_code: COUNTRY,
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  }),
  update: z.object({
    name: z.string().min(1).optional(),
    carrier_code: z.string().max(20).nullish(),
    country_code: COUNTRY,
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
