"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({ dictionary_item_id: z.string().uuid(), shipping_line: z.string().optional().nullable(), variant: z.string().optional().nullable(), rate: z.number().nonnegative(), currency: z.string().length(3).optional(), effective_from: d.optional(), effective_to: d.optional().nullable() }),
  update: z.object({ shipping_line: z.string().optional().nullable(), variant: z.string().optional().nullable(), rate: z.number().nonnegative().optional(), currency: z.string().length(3).optional(), effective_from: d.optional(), effective_to: d.optional().nullable() }),
  // AI-facing: expense_rate_id in the payload → list_expense_rates picker.
  aiUpdate: z.object({ expense_rate_id: z.string().uuid(), shipping_line: z.string().optional().nullable(), variant: z.string().optional().nullable(), rate: z.number().nonnegative().optional(), currency: z.string().length(3).optional(), effective_from: d.optional(), effective_to: d.optional().nullable() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), schemas };
