"use strict";
const service = require("./cash_request.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { enqueueDocument } = require("../../../services/documents/generate");
const actor = (req) => req.user || { user_id: null };

/** Context fields that flow through the PATCH body into the request row. */
const CTX_KEYS = ["dossier_id", "costing_id", "beneficiary", "category", "cost_center", "overhead_justification", "remarks", "disbursement_method", "disbursement_details"];
const ctxOf = (b) => {
  const out = {};
  for (const k of CTX_KEYS) if (b[k] !== undefined) out[k] = b[k];
  return out;
};

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Cash request not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, { dossierId: b.dossier_id, costingId: b.costing_id, requestedBy: b.requested_by, lines: b.lines || [], beneficiary: b.beneficiary, category: b.category, costCenter: b.cost_center, overheadJustification: b.overhead_justification, remarks: b.remarks, disbursementMethod: b.disbursement_method, disbursementDetails: b.disbursement_details, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateDraft(c, { id: req.params.id, lines: req.body.lines || null, patch: ctxOf(req.body), actor: actor(req) })) })),
  importCosting: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.importCostingLines(c, { id: req.params.id, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: b.to, entityId: b.entity_id, date: b.date, actor: actor(req) }));
    // Submitting numbers + captures the request — mint its PDF then too.
    if (data && b.to === "SUBMITTED") {
      enqueueDocument({ tenantMeta: req.tenant, env: req.env, docType: "CASH_REQUEST", recordId: req.params.id });
    }
    res.json({ data });
  }),
  disburse: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.disburse(c, { id: req.params.id, amount: b.amount === undefined ? null : b.amount, entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, treasuryCoa: b.treasury_coa, treasuryAccountId: b.treasury_account_id || null, holderUserId: b.holder_user_id, memo: b.memo || null, actor: actor(req), ip: req.ip }));
    res.json({ data });
  }),
  justify: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.justify(c, { id: req.params.id, lines: req.body.lines || [], entityId: req.body.entity_id || null, entryDate: req.body.entry_date || null, actor: actor(req), ip: req.ip })) })),
};
