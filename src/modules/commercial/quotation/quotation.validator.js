"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), qty: z.number().positive().optional(), unit_price: z.number().nonnegative().optional(), is_debours: z.boolean().optional(), tax_code_id: z.string().uuid().optional().nullable() });
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({ entity_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(), currency: z.string().length(3).optional(), quote_model: z.enum(["HT_ON_TOP", "TTC"]).optional(), margin_percent: z.number().optional().nullable(), valid_until: d.optional().nullable(), lines: z.array(line).optional() }),
  update: z.object({ client_id: z.string().uuid().optional().nullable(), dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(), currency: z.string().length(3).optional(), quote_model: z.enum(["HT_ON_TOP", "TTC"]).optional(), margin_percent: z.number().optional().nullable(), valid_until: d.optional().nullable(), lines: z.array(line).optional() }),
  transition: z.object({ to: z.enum(["SENT", "REJECTED", "EXPIRED"]), entity_id: z.string().uuid().optional().nullable() }),
  accept: z.object({ convert: z.boolean().optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), accept: mw("accept"), schemas };
