"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({
    dictionary_item_id: z.string().uuid(),
    rate_provider_id: z.string().uuid().optional().nullable(),
    container_type_ref_id: z.string().uuid().optional().nullable(),
    rate: z.number().nonnegative(),
    currency: z.string().length(3).optional(),
    effective_from: d.optional(),
    effective_to: d.optional().nullable(),
    note: z.string().optional().nullable(),
  }),
  update: z.object({
    rate_provider_id: z.string().uuid().optional().nullable(),
    container_type_ref_id: z.string().uuid().optional().nullable(),
    rate: z.number().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    effective_from: d.optional(),
    effective_to: d.optional().nullable(),
    note: z.string().optional().nullable(),
  }),
  // AI-facing: expense_rate_id in the payload → list_expense_rates picker.
  aiUpdate: z.object({
    expense_rate_id: z.string().uuid(),
    rate_provider_id: z.string().uuid().optional().nullable(),
    container_type_ref_id: z.string().uuid().optional().nullable(),
    rate: z.number().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    effective_from: d.optional(),
    effective_to: d.optional().nullable(),
  }),
  resolveQuery: z.object({
    dictionary_item_id: z.string().uuid(),
    date: d.optional(),
    rate_provider_id: z.string().uuid().optional(),
    container_type_ref_id: z.string().uuid().optional(),
  }),
  // G7 — bulk import. Uploads ride the same base64 data-URL convention as the
  // vault and the financial-dictionary importer (one upload shape, no
  // multipart middleware). Commit carries the STAGING rows; raw cell values
  // are re-validated server-side.
  importUpload: z.object({
    file: z.string().min(1),
    filename: z.string().optional(),
  }),
  importCommit: z.object({
    rows: z.array(z.object({
      row: z.number().int().positive().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
      raw: z.record(z.string(), z.unknown()).default({}),
    })).max(2000),
  }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), importUpload: mw("importUpload"), importCommit: mw("importCommit"), schemas };
