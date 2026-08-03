"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({
  dictionary_item_id: z.string().uuid(),
  amount: z.number().positive(),
  is_debours: z.boolean().optional(),
  label: z.string().optional(),
});
const createDraft = z.object({
  entity_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  dossier_id: z.string().uuid().optional(),
  lines: z.array(line).optional(),
});
const updateDraft = z.object({
  client_id: z.string().uuid().optional(),
  dossier_id: z.string().uuid().optional(),
  lines: z.array(line).optional(),
});
const submit = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
});
// AI-facing: invoice_id in the payload → list_final_invoices picker.
const aiUpdate = z.object({ invoice_id: z.string().uuid(), client_id: z.string().uuid().optional(), dossier_id: z.string().uuid().optional(), lines: z.array(line).optional() });
const aiSubmit = submit.extend({ invoice_id: z.string().uuid() });
const schemas = { createDraft, updateDraft, submit, aiUpdate, aiSubmit };
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { createDraft: mw("createDraft"), updateDraft: mw("updateDraft"), submit: mw("submit"), schemas };
