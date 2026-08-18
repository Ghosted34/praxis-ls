"use strict";
const service = require("./dossier_reconciliation.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  get: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.get(c, req.params.id)) })),
  latest: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.latest(c, { dossierId: req.query.dossier_id })) })),
  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.createDraft(c, { dossierId: req.body.dossier_id, actor: actor(req) })) })),
  submit: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.submit(c, { id: req.params.id, actor: actor(req) })) })),
  validate: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.validate(c, { id: req.params.id, actor: actor(req) })) })),
  reject: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.reject(c, { id: req.params.id, reason: req.body.reason, actor: actor(req) })) })),
};
