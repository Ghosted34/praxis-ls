"use strict";
const service = require("./debt.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Debt engagement not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createEngagement(c, { entityId: b.entity_id, dossierId: b.dossier_id, lenderKind: b.lender_kind, lenderName: b.lender_name, principal: b.principal, currency: b.currency, interestRate: b.interest_rate, coaCode: b.coa_code, startedOn: b.started_on, dueOn: b.due_on, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  drawdown: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.drawdown(c, { id: req.params.id, entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, treasuryCoa: b.treasury_coa, actor: actor(req), ip: req.ip }));
    res.json({ data });
  }),
  repay: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.repay(c, { id: req.params.id, entityId: b.entity_id, entryDate: b.entry_date, principalPart: b.principal_part, interestPart: b.interest_part, treasuryCoa: b.treasury_coa, interestCoa: b.interest_coa, sourceDocRef: b.source_doc_ref, actor: actor(req), ip: req.ip }));
    res.json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateEngagement(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.removeEngagement(c, { id: req.params.id, actor: actor(req) })) })),
};
