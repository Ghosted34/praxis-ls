"use strict";
const service = require("./portal.service");
const { asyncHandler } = require("../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  listAccess: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listAccess(c, req.query)) })),
  grant: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.grantAccess(c, { portal: b.portal, subjectEmail: b.subject_email, clientId: b.client_id, expiresAt: b.expires_at, actor: actor(req) })) }); }),
  revoke: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.revokeAccess(c, { id: req.params.id, actor: actor(req) })) })),
  check: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.checkAccess(c, { email: req.query.email, portal: req.query.portal })) })),
  client: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.clientView(c, { clientId: req.query.client_id })) })),
  investor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.investorView(c, { params: req.query })) })),
  auditor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.auditorView(c, { params: req.query })) })),
};
