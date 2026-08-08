"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({ country_code: z.string().length(2).optional(), name: z.string().min(1), currency: z.string().length(3).optional() }),
  update: z.object({ name: z.string().optional(), currency: z.string().length(3).optional(), country_code: z.string().length(2).optional() }),
  setActive: z.object({ active: z.boolean() }),
  addCode: z.object({
    code: z.string().min(1), kind: z.enum(["VAT", "WHT", "INCOME", "PAYROLL", "OTHER"]), rate_percent: z.number().min(0).max(100).optional().nullable(),
    base_rule: z.string().optional().nullable(), applies_to: z.string().optional().nullable(), recoverable: z.boolean().optional().nullable(),
    posts_debit_account: z.string().optional().nullable(), posts_credit_account: z.string().optional().nullable(), brackets: z.any().optional().nullable(),
    effective_from: d.optional(), effective_to: d.optional().nullable(), legal_reference: z.string().optional().nullable(),
  }),
  // Amend a rate at a Finance-Law boundary: expire the current row (day before)
  // and open a new one, atomically. effective_from is the pivot, so it is required.
  supersede: z.object({
    code: z.string().min(1), effective_from: d, kind: z.enum(["VAT", "WHT", "INCOME", "PAYROLL", "OTHER"]),
    rate_percent: z.number().min(0).max(100).optional().nullable(),
    base_rule: z.string().optional().nullable(), applies_to: z.string().optional().nullable(), recoverable: z.boolean().optional().nullable(),
    posts_debit_account: z.string().optional().nullable(), posts_credit_account: z.string().optional().nullable(), brackets: z.any().optional().nullable(),
    effective_to: d.optional().nullable(), legal_reference: z.string().optional().nullable(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), setActive: mw("setActive"), addCode: mw("addCode"), supersede: mw("supersede"), schemas };
