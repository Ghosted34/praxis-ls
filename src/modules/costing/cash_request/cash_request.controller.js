"use strict";
const service = require("./cash_request.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Cash request not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, { dossierId: b.dossier_id, costingId: b.costing_id, requestedBy: b.requested_by, lines: b.lines || [], actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateDraft(c, { id: req.params.id, lines: req.body.lines || null, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: b.to, entityId: b.entity_id, date: b.date, actor: actor(req) }));
    res.json({ data });
  }),
  disburse: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.disburse(c, { id: req.params.id, entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, treasuryCoa: b.treasury_coa, holderUserId: b.holder_user_id, actor: actor(req), ip: req.ip }));
    res.json({ data });
  }),
  justify: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.justify(c, { id: req.params.id, lines: req.body.lines || [], entityId: req.body.entity_id || null, entryDate: req.body.entry_date || null, actor: actor(req), ip: req.ip })) })),
};
