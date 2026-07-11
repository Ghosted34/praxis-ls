"use strict";
const service = require("./milestone.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  listTemplates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listTemplates(c, req.query)) })),
  publishTemplate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.publishTemplate(c, { serviceTypeId: req.body.service_type_id, stages: req.body.stages, actor: actor(req) })) })),
  instantiate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.instantiate(c, { dossierId: req.body.dossier_id, serviceTypeId: req.body.service_type_id, baseDate: req.body.base_date, actor: actor(req) })) })),
  byDossier: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listByDossier(c, req.params.dossierId)) })),
  advance: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.advance(c, { instanceId: req.params.id, to: req.body.to, evidenceVaultId: req.body.evidence_vault_id, actor: actor(req) })) })),
};
