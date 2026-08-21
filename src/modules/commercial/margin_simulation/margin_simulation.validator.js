"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const line = z.object({
  dictionary_item_id: z.string().uuid().optional().nullable(),
  label: z.string().optional(),
  qty: z.number().positive().optional(),
  unit_cost: z.number().nonnegative().optional(),
  unit_price: z.number().nonnegative().optional(),
  is_disbursement: z.boolean().optional(),
  // §3.1 — legacy per-line VAT toggle + notes. The rate is settings
  // finance.vat at compute time, never part of the payload.
  vat_applicable: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const UUID = z.string().uuid();

const schemas = {
  compute: z.object({
    dossier_id: UUID.optional().nullable(),
    service_type_id: UUID.optional().nullable(),
    costing_id: UUID.optional().nullable(),
    currency: z.string().length(3).optional(),
    lines: z.array(line).min(1),
  }),
  idParam: z.object({ id: UUID }),
  costingParam: z.object({ costingId: UUID }),
  reject: z.object({ id: UUID, reason: z.string().trim().min(3).max(2000) }),
  // §2.4a — editing a DRAFT/REJECTED simulation. Every field optional: the
  // screen patches what changed. `lines` absent leaves the line set alone;
  // `lines` present replaces it wholesale (same contract as the costing).
  update: z.object({
    id: UUID,
    dossier_id: UUID.optional().nullable(),
    service_type_id: UUID.optional().nullable(),
    costing_id: UUID.optional().nullable(),
    currency: z.string().length(3).optional(),
    lines: z.array(line).min(1).optional(),
  }),
  // §2.5 — the reason travels with the submit that needs it.
  submit: z.object({ id: UUID, justification: z.string().trim().max(2000).optional().nullable() }),
};

// AI-facing: the simulation is named in the body, not the path (same
// convention as the costing's aiUpdate).
schemas.aiUpdate = schemas.update.omit({ id: true }).extend({ margin_simulation_id: UUID });

const mw = (k, fromParams = false) => (req, _res, next) => {
  const source = fromParams ? req.params : { ...req.body, ...req.params };
  const p = schemas[k].safeParse(source);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  if (fromParams) req.params = p.data;
  else req.body = { ...req.body, ...p.data };
  return next();
};

module.exports = {
  compute: mw("compute"),
  idParam: mw("idParam", true),
  costingParam: mw("costingParam", true),
  reject: mw("reject"),
  update: mw("update"),
  submit: mw("submit"),
  schemas,
};
