"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), qty: z.number().positive().optional(), unit_price: z.number().nonnegative(), tax_code_id: z.string().uuid().optional().nullable(), container_type_ref_id: z.string().uuid().nullish(), expense_account: z.string().min(1) });
const schemas = {
  create: z.object({
    entity_id: z.string().uuid(), supplier_id: z.string().uuid().optional().nullable(), po_id: z.string().uuid().optional().nullable(), grn_id: z.string().uuid().optional().nullable(),
    dossier_id: z.string().uuid().optional().nullable(), supplier_ref: z.string().optional(), currency: z.string().length(3).optional(),
    vat_total: z.number().nonnegative().optional(), wht_total: z.number().nonnegative().optional(), due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), lines: z.array(line).min(1),
  }),
  post: z.object({ entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source_doc_ref: z.string().min(1).optional(), supplier_account: z.string().optional() }),
  // 10720: pay a POSTED_LOCKED invoice. `amount` OPTIONAL and defaults
  // server-side to the whole outstanding balance, so the ordinary full payment
  // is a body without an amount (same convention as cash_request disburse).
  pay: z.object({ amount: z.number().positive().optional(), entity_id: z.string().uuid().optional().nullable(), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), treasury_account_id: z.string().uuid().optional().nullable(), treasury_coa: z.string().optional(), note: z.string().max(500).optional() }),
  // AI-facing: supplier_invoice_id in the payload → list_supplier_invoices picker.
  aiPost: z.object({ supplier_invoice_id: z.string().uuid(), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source_doc_ref: z.string().min(1).optional(), supplier_account: z.string().optional() }),
  aiPay: z.object({ supplier_invoice_id: z.string().uuid(), amount: z.number().positive().optional(), entity_id: z.string().uuid().optional().nullable(), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), treasury_account_id: z.string().uuid().optional().nullable(), note: z.string().max(500).optional() }),
  // 10721: reverse a posted/paid invoice — contra entries for the posting and
  // any payments, status REVERSED.
  reverse: z.object({ reason: z.string().optional(), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  aiReverse: z.object({ supplier_invoice_id: z.string().uuid(), reason: z.string().optional(), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  match: z.object({}).strict(),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), post: mw("post"), match: mw("match"), pay: mw("pay"), reverse: mw("reverse"), schemas };
