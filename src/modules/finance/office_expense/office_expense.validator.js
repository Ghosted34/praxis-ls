"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Kept in sync with service.CATEGORIES and the shared/FE constant — the enum
// lives app-side per the 13791 rule (no CHECK on the column).
const category = z.enum(["RENT", "UTILITIES", "SUPPLIES", "CONNECTIVITY", "MAINTENANCE", "CLEANING", "OTHER"]);
const schemas = {
  create: z.object({
    entity_id: z.string().uuid(),
    category,
    label: z.string().trim().min(1),
    supplier_id: z.string().uuid().optional().nullable(),
    expense_date: d.optional(),
    amount: z.number().positive(),
    currency: z.string().length(3).optional(),
    expense_coa: z.string().trim().min(1),
    notes: z.string().optional().nullable(),
  }),
  update: z.object({
    category: category.optional(),
    label: z.string().trim().min(1).optional(),
    supplier_id: z.string().uuid().optional().nullable(),
    expense_date: d.optional(),
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    expense_coa: z.string().trim().min(1).optional(),
    notes: z.string().optional().nullable(),
  }),
  post: z.object({
    entry_date: d.optional(),
    paid_via: z.enum(["BANK", "CASH"]).optional(),
    credit_coa: z.string().optional(),
    source_doc_ref: z.string().optional(),
  }),
  // AI-facing: expense_id in the payload → list_office_expenses picker.
  aiPost: z.object({
    expense_id: z.string().uuid(),
    entry_date: d.optional(),
    paid_via: z.enum(["BANK", "CASH"]).optional(),
    credit_coa: z.string().optional(),
    source_doc_ref: z.string().optional(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), post: mw("post"), schemas };
