"use strict";
const service = require("./q_ticket.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  detail: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.detail(c, { ticketId: req.params.id })) })),
  raise: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.raise(c, { dossierId: req.body.dossier_id, milestoneInstanceId: req.body.milestone_instance_id, subject: req.body.subject, body: req.body.body, raisedBy: req.body.raised_by, actor: actor(req) })) })),
  reply: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.reply(c, { ticketId: req.params.id, body: req.body.body, internal: req.body.internal, evidenceVaultId: req.body.evidence_vault_id, actor: actor(req) })) })),
  resolve: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.resolve(c, { ticketId: req.params.id, actor: actor(req) })) })),
};
