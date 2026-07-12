"use strict";
const service = require("./opportunity.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  board: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.board(c)) })),
  stages: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.stages(c)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Opportunity not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  move: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.moveStage(c, { id: req.params.id, pipelineStageId: req.body.pipeline_stage_id, actor: actor(req) })) })),
  win: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.win(c, { id: req.params.id, createDossier: b.create_dossier === true, entityId: b.entity_id, serviceTypeId: b.service_type_id, actor: actor(req) })) }); }),
  lose: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.lose(c, { id: req.params.id, actor: actor(req) })) })),
};
