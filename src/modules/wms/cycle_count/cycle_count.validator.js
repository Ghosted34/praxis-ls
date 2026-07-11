"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  location_id: z.string().uuid().optional(),
  counted_by: z.string().uuid().optional(),
  discrepancy: z.record(z.any()).optional(), // jsonb: {inventory_item_id: {expected, counted}}
  certified_report_vault_id: z.string().uuid().optional(), // Rapport d'Audit
});
const schemas = { create, update: create.partial() };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), schemas };
