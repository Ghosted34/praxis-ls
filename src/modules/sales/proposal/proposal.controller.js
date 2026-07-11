"use strict";
const service = require("./proposal.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Proposal not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createDraft(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.updateDraft(c, { id: req.params.id, patch: b, lines: b.lines || null, narratives: b.narratives || null, actor: actor(req) })) }); }),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, entityId: req.body.entity_id, actor: actor(req) })) })),
  accept: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.accept(c, { id: req.params.id, createQuotation: b.create_quotation === true, entityId: b.entity_id, actor: actor(req) })) }); }),
};
