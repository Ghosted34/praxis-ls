"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const base = {
  entity_id: z.string().uuid().optional(),
  name: z.string().min(1),
  supplier_type: z.string().optional(),
  niu: z.string().optional(), rccm: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  // 0480 — supplier address. Needed on a purchase order (where goods are
  // collected from / the supplier's legal address on a matched invoice).
  address: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  country_code: z.string().length(2).optional().or(z.literal("")),
  payment_method: z.enum(["BANK", "CASH", "MOBILE_MONEY", "CHEQUE"]).optional(),
  momo_network: z.string().optional(), momo_number: z.string().optional(),
  is_non_resident: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).optional(),
};
const create = z.object(base);
const update = z.object({ ...base, name: z.string().min(1).optional(), is_active: z.boolean().optional() });
const schemas = { create, update };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), schemas };
