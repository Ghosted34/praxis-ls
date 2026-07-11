"use strict";
const service = require("./success_story.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Success story not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  signOff: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.signOff(c, { id: req.params.id, actor: actor(req) })) })),
  publish: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.publish(c, { id: req.params.id, actor: actor(req) })) })),
  unpublish: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.unpublish(c, { id: req.params.id, actor: actor(req) })) })),
};
