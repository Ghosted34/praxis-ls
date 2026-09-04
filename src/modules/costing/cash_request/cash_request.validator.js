"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const line = z.object({
  // 12771 — the worksheet round-trips the line's own id so an edit is
  // unambiguous even when its label and amount both change; absent means new.
  cash_request_line_id: z.string().uuid().optional(),
  // 12771 — the BUDGET LINE this claim draws down. Required on every line of an
  // OPS request before it can be submitted (enforced in the service, so the AI
  // and the import hit the same wall as the route).
  costing_line_id: z.string().uuid().optional().nullable(),
  dictionary_item_id: z.string().uuid().optional().nullable(),
  label: z.string().optional(),
  // 12771 — the legacy line shape. `budget_amount` alone still works and is
  // read as 1 x that amount, so every existing caller is unaffected.
  qty: z.number().positive().optional(),
  unit_cost: z.number().nonnegative().optional(),
  budget_amount: z.number().nonnegative().optional(),
  spent_amount: z.number().nonnegative().optional(),
  is_disbursement: z.boolean().optional(),
  proof_vault_id: z.string().uuid().optional().nullable(),
  // §3.5 — legacy per-line VAT % and "Just. Req?" (10746).
  vat_percent: z.number().min(0).max(100).optional().nullable(),
  justification_required: z.boolean().optional(),
});
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
  // §3.5 — how the money leaves (legacy :499); the per-method required fields
  // (:505-514) are a service rule so every caller hits the same wall.
  disbursement_method: z.enum(["CASH", "BANK", "CHEQUE", "MOMO"]).optional().nullable(),
  disbursement_details: z.record(z.string(), z.string()).optional().nullable(),
  // 12771 — an OPS request INHERITS the costing's currency (the service
  // enforces it); these are for an overhead request, which has no costing.
  currency: z.string().length(3).optional(),
  exchange_rate_to_xaf: z.number().positive().optional(),
};
const schemas = {
  create: z.object({ dossier_id: z.string().uuid().optional().nullable(), costing_id: z.string().uuid().optional().nullable(), requested_by: z.string().uuid().optional().nullable(), lines: z.array(line).optional(), ...context }),
  update: z.object({ lines: z.array(line), ...context }),
  // 12771 — DRAFT reopens a rejected request (the legacy allowed it and we did
  // not). `reason` is REQUIRED for REJECTED and `over_budget_reason` when a
  // submission claims more than the budget has left; both are enforced in the
  // service, where the ledger is in hand.
  transition: z.object({
    to: z.enum(["SUBMITTED", "VALIDATED", "APPROVED", "REJECTED", "DRAFT"]),
    entity_id: z.string().uuid().optional().nullable(),
    date: d.optional(),
    reason: z.string().max(2000).optional(),
    over_budget_reason: z.string().max(2000).optional(),
  }),
  closeBalance: z.object({ reason: z.string().trim().min(1).max(2000) }),
  acknowledge: z.object({
    ack_kind: z.enum(["IN_APP", "WET_SCAN"]).optional(),
    received_by: z.string().uuid().optional().nullable(),
  }),
  importCosting: z.object({}).strict(),
  // AI-facing: cash_request_id in the payload → list_cash_requests picker.
  aiUpdate: z.object({ cash_request_id: z.string().uuid(), lines: z.array(line), ...context }),
  aiImportCosting: z.object({ cash_request_id: z.string().uuid() }),
  aiTransition: z.object({ cash_request_id: z.string().uuid(), to: z.enum(["SUBMITTED", "VALIDATED", "APPROVED", "REJECTED", "DRAFT"]), entity_id: z.string().uuid().optional().nullable(), date: d.optional(), reason: z.string().max(2000).optional(), over_budget_reason: z.string().max(2000).optional() }),
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
module.exports = {
  create: mw("create"), update: mw("update"), transition: mw("transition"),
  disburse: mw("disburse"), justify: mw("justify"), importCosting: mw("importCosting"),
  closeBalance: mw("closeBalance"), acknowledge: mw("acknowledge"),
  schemas,
};
