"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const record = z.object({
  dossier_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  dictionary_item_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  category: z.string().optional(),
  is_debours: z.boolean().optional(),
  expense_coa: z.string().optional(),
  treasury_coa: z.string().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
});
const schemas = { record };
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { record: mw("record"), schemas };
