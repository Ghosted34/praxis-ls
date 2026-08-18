"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().optional(), budget_amount: z.number().nonnegative().optional(), spent_amount: z.number().nonnegative().optional(), is_disbursement: z.boolean().optional(), proof_vault_id: z.string().uuid().optional().nullable() });
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// The OPS/OVH context fields the legacy screen carried (analysis doc §6.7):
// beneficiary, category (OPS default), cost centre + justification for OVH,
// remarks. The cross-field rules (OPS needs a dossier, OVH needs cost centre +
// justification) are enforced in the service so they hold for every caller.
const context = {
  beneficiary: z.string().optional().nullable(),
  category: z.enum(["OPS", "OVH"]).optional(),
  cost_center: z.string().optional().nullable(),
  overhead_justification: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
};
const schemas = {
  create: z.object({ dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), requested_by: z.string().uuid().optional().nullable(), lines: z.array(line).optional(), ...context }),
  update: z.object({ lines: z.array(line), ...context }),
  transition: z.object({ to: z.enum(["SUBMITTED", "VALIDATED", "APPROVED", "REJECTED"]), entity_id: z.string().uuid().optional().nullable(), date: d.optional() }),
  importCosting: z.object({}).strict(),
  // AI-facing: cash_request_id in the payload → list_cash_requests picker.
  aiUpdate: z.object({ cash_request_id: z.string().uuid(), lines: z.array(line), ...context }),
  aiImportCosting: z.object({ cash_request_id: z.string().uuid() }),
  aiTransition: z.object({ cash_request_id: z.string().uuid(), to: z.enum(["SUBMITTED", "VALIDATED", "APPROVED", "REJECTED"]), entity_id: z.string().uuid().optional().nullable(), date: d.optional() }),
  // The AI adapter passes its payload straight through, so a write action MUST
  // carry the entity id in its own schema. `disburse` did not: the manifest
  // used the bare `disburse` schema and called `service.disburse(c, payload)`,
  // which arrives with `id: undefined` and 404s on every attempt. Pre-existing;
  // fixed alongside 10719 rather than left as an action that cannot work.
  aiDisburse: z.object({ cash_request_id: z.string().uuid(), amount: z.number().positive().optional(), entity_id: z.string().uuid(), entry_date: d, source_doc_ref: z.string().optional(), treasury_account_id: z.string().uuid().optional().nullable(), holder_user_id: z.string().uuid().optional().nullable(), memo: z.string().max(500).optional() }),
  aiJustify: z.object({ cash_request_id: z.string().uuid(), lines: z.array(line), entity_id: z.string().uuid().optional(), entry_date: d.optional() }),
  // `amount` is OPTIONAL and defaults server-side to the whole outstanding
  // balance, so a single full payment stays a body without an amount. Positive
  // when present: a zero or negative instalment is not a disbursement (10719).
  disburse: z.object({ amount: z.number().positive().optional(), entity_id: z.string().uuid(), entry_date: d, source_doc_ref: z.string().optional(), treasury_coa: z.string().optional(), treasury_account_id: z.string().uuid().optional().nullable(), holder_user_id: z.string().uuid().optional().nullable(), memo: z.string().max(500).optional() }),
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
