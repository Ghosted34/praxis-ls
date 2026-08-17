"use strict";
const service = require("./milestone.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  listTemplates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listTemplates(c, req.query)) })),
  publishTemplate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.publishTemplate(c, { serviceTypeId: req.body.service_type_id, stages: req.body.stages, actor: actor(req) })) })),
  instantiate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.instantiate(c, { dossierId: req.body.dossier_id, serviceTypeId: req.body.service_type_id, baseDate: req.body.base_date, actor: actor(req) })) })),
  byDossier: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listByDossier(c, req.params.dossierId)) })),
  advance: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.advance(c, { instanceId: req.params.id, to: req.body.to, evidenceVaultId: req.body.evidence_vault_id, causeReasonCode: req.body.cause_reason_code, causeNote: req.body.cause_note, actor: actor(req) })) })),
  updatePublicDetails: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updatePublicDetails(c, { instanceId: req.params.id, details: req.body, actor: actor(req) })) })),
  reopen: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.reopen(c, { instanceId: req.params.id, reason: req.body.reason, actor: actor(req) })) })),
  addStage: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.addStage(c, { dossierId: req.params.dossierId, afterSeq: req.body.after_seq, code: req.body.code, label: req.body.label, labelEn: req.body.label_en, weight: req.body.weight, minDurationHours: req.body.min_duration_hours, ownerTier: req.body.owner_tier, isClientVisible: req.body.is_client_visible, actor: actor(req) })) })),
  recalculate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.recalculate(c, { dossierId: req.params.dossierId, trigger: req.body.trigger || "MANUAL", actor: actor(req) })) })),
  attribution: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.attribution(c, { from: req.query.from || null, to: req.query.to || null, serviceTypeId: req.query.service_type_id || null })) })),
  systemDefault: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSystemDefault(c, req.params.serviceTypeId)) })),
  assumptions: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listAssumptions(c, req.params.serviceTypeId)) })),
  saveAssumptions: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.saveAssumptions(c, { serviceTypeId: req.params.serviceTypeId, assumptions: req.body.assumptions, actor: actor(req) })) })),
};
