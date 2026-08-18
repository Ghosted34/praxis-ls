"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), budget_amount: z.number().nonnegative().optional(), spent_amount: z.number().nonnegative().optional(), is_disbursement: z.boolean().optional(), proof_vault_id: z.string().uuid().optional().nullable() });
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schemas = {
  create: z.object({ dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), requested_by: z.string().uuid().optional().nullable(), lines: z.array(line).optional() }),
  update: z.object({ lines: z.array(line) }),
  transition: z.object({ to: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]), entity_id: z.string().uuid().optional().nullable(), date: d.optional() }),
  // AI-facing: cash_request_id in the payload → list_cash_requests picker.
  aiUpdate: z.object({ cash_request_id: z.string().uuid(), lines: z.array(line) }),
  aiTransition: z.object({ cash_request_id: z.string().uuid(), to: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]), entity_id: z.string().uuid().optional().nullable(), date: d.optional() }),
  aiJustify: z.object({ cash_request_id: z.string().uuid(), lines: z.array(line), entity_id: z.string().uuid().optional(), entry_date: d.optional() }),
  disburse: z.object({ entity_id: z.string().uuid(), entry_date: d, source_doc_ref: z.string().optional(), treasury_coa: z.string().optional(), holder_user_id: z.string().uuid().optional().nullable() }),
  // entity_id / entry_date are needed because justify now RETIRES the linked
  // régie advance in the same transaction, and that posting needs an entity and
  // a date. Both optional: entity_id falls back to the one stored on the advance
  // (10717), entry_date to today.
  justify: z.object({ lines: z.array(line), entity_id: z.string().uuid().optional(), entry_date: d.optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), disburse: mw("disburse"), justify: mw("justify"), schemas };
