"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const record = z.object({
  dossier_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  dictionary_item_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  category: z.string().optional(),
  is_disbursement: z.boolean().optional(),
  expense_coa: z.string().optional(),
  treasury_coa: z.string().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
});
// §3.4 — fast multi-line entry: the whole sheet in one transaction, the way
// the legacy saved all its categories at once.
const bulkLine = z.object({
  dictionary_item_id: z.string().uuid().optional().nullable(),
  amount: z.number().positive(),
  category: z.string().optional().nullable(),
  is_disbursement: z.boolean().optional(),
  expense_coa: z.string().optional().nullable(),
  treasury_coa: z.string().optional().nullable(),
  proof_vault_id: z.string().uuid().optional().nullable(),
});
const bulk = z.object({
  dossier_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_doc_ref: z.string().min(1),
  lines: z.array(bulkLine).min(1).max(200),
});
// §3.4 — the optional per-item earmark of a per-file advance (owner-decided).
const allocate = z.object({
  dictionary_item_id: z.string().uuid(),
  amount: z.number().positive(),
  note: z.string().max(2000).optional().nullable(),
});
const advanceParam = z.object({ advanceId: z.string().uuid() });
const allocationParam = z.object({ allocationId: z.string().uuid() });
const schemas = { record, bulk, allocate, advanceParam, allocationParam };
const mw = (k, fromParams = false) => (req, _res, next) => {
  const p = schemas[k].safeParse(fromParams ? req.params : req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  if (fromParams) req.params = p.data;
  else req.body = p.data;
  return next();
};
module.exports = { record: mw("record"), bulk: mw("bulk"), allocate: mw("allocate"), advanceParam: mw("advanceParam", true), allocationParam: mw("allocationParam", true), schemas };
