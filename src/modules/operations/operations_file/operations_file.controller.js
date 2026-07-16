"use strict";
const service = require("./operations_file.service");
const { maskForUserVia } = require("../../../shared/rbac/field-mask");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Dossier not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) })),
  // 360° modal is role-gated on money (PRD §7.3/§11.3): Sales/Ops never see margin.
  // Data on the env client; masked field_keys resolved from the identity schema.
  overview: asyncHandler(async (req, res) => res.json({ data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.overview(c, req.params.id))) })),
};
