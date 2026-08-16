"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({
    entity_id: z.string().uuid(),
    dossier_id: z.string().uuid().optional().nullable(),
    consignee: z.string().optional(),
    city_zone: z.string().optional(),
    contact_person: z.string().optional(),
    // G23 — where the goods went, who to ring, and when they actually arrived.
    address: z.string().max(500).optional().nullable(),
    phone: z.string().max(60).optional().nullable(),
    delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    lines: z.array(z.object({
      inventory_item_id: z.string().uuid().optional().nullable(),
      // A line is its description. `min(1)` here so a blank one is refused at
      // the edge with a field-keyed 422, rather than reaching the service.
      label: z.string().min(1).optional(),
      qty: z.number().nonnegative().optional(),
    })).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), schemas };
