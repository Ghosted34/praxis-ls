"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
  create: z.object({
    client_id: z.string().uuid().optional().nullable(),
    method: z.enum(["BANK", "CASH", "MOBILE_MONEY", "CHEQUE"]).optional(),
    treasury_account_id: z.string().uuid().optional().nullable(),
    amount: z.number().positive(),
    received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  post: z.object({
    entity_id: z.string().uuid(),
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source_doc_ref: z.string().min(1).optional(),
    customer_account: z.string().optional(),
  }),
  // AI-facing: receipt_id in the payload → list_receipts picker.
  aiPost: z.object({
    receipt_id: z.string().uuid(),
    entity_id: z.string().uuid(),
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source_doc_ref: z.string().min(1).optional(),
    customer_account: z.string().optional(),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), post: mw("post"), schemas };
