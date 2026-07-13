"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const line = z.object({
  dictionary_item_id: z.string().uuid().optional().nullable(),
  label: z.string().min(1),
  amount: z.number().nonnegative(),
  is_debours: z.boolean().optional(),
});

const schemas = {
  create: z.object({
    entity_id: z.string().uuid(),
    client_id: z.string().uuid().optional().nullable(),
    dossier_id: z.string().uuid().optional().nullable(),
    reverses_invoice_id: z.string().uuid().optional().nullable(),
    lines: z.array(line).optional(),
  }),
  update: z.object({
    client_id: z.string().uuid().optional().nullable(),
    dossier_id: z.string().uuid().optional().nullable(),
    reverses_invoice_id: z.string().uuid().optional().nullable(),
    lines: z.array(line).optional(),
  }),
  post: z.object({
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    source_doc_ref: z.string().max(120).optional().nullable(),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body ?? {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), post: mw("post"), schemas };
