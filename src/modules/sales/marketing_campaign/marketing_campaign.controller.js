"use strict";
const service = require("./marketing_campaign.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Campaign not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) })),
  send: asyncHandler(async (req, res) => res.status(202).json({ data: await req.tenantDb((c) => service.sendCampaign(c, { id: req.params.id, templateId: req.body.template_id, tenantMeta: req.tenant, env: req.env || "live", actor: actor(req) })) })),
  subscribers: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.subscribers(c, req.query)) })),
  subscribe: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.subscribe(c, { email: b.email, name: b.name, source: b.source, actor: actor(req) })) }); }),
  unsubscribe: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.unsubscribe(c, { email: req.body.email, actor: actor(req) })) })),
  // Sending identities
  listSenders: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSenders(c)) })),
  createSender: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createSender(c, { data: req.body, actor: actor(req) })) })),
  verifySender: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.verifySender(c, { id: req.params.id, actor: actor(req) })) })),
  deleteSender: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteSender(c, { id: req.params.id, actor: actor(req) })) })),
  // Email templates
  listTemplates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listTemplates(c)) })),
  getTemplate: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.getTemplate(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Template not found", 404); res.json({ data: r }); }),
  createTemplate: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createTemplate(c, { data: req.body, actor: actor(req) })) })),
  updateTemplate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateTemplate(c, { id: req.params.id, data: req.body, actor: actor(req) })) })),
  deleteTemplate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteTemplate(c, { id: req.params.id, actor: actor(req) })) })),
};
