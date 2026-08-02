"use strict";
const service = require("./mail.service");
const { asyncHandler } = require("../../utils/errors");
const { config } = require("../../config/env");
const actor = (req) => req.user || { user_id: null };
const slugOf = (req) => req.tenant && req.tenant.slug;
const msRedirect = (req) => config.MS_GRAPH_REDIRECT_URI || `${req.protocol}://${req.get("host")}${req.baseUrl}/oauth/microsoft/callback`;
const ggRedirect = (req) => config.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}${req.baseUrl}/oauth/google/callback`;
const msWebhook = (req) => `${req.protocol}://${req.get("host")}${req.baseUrl}/webhook/microsoft`;
module.exports = {
  // ── Read-only view (original) ──
  senders: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listIdentities(c)) })),
  sent: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSent(c, req.query)) })),
  inbox: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listInbox(c, req.query)) })),
  updateSender: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateIdentity(c, req.params.id, req.body || {})) })),
  upsertSender: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.upsertIdentity(c, req.body || {})) })),

  // ── Engine: connections ──
  autodiscover: asyncHandler(async (req, res) => res.json({ data: await service.autodiscover({ email: req.query.email }) })),
  listConnections: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listConnections(c, req.query)) })),
  connect: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.connect(c, { ...req.body, actor: actor(req) })) })),
  testConnection: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.testConnection(c, req.params.id)) })),
  syncNow: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.syncConnection(c, req.params.id, { slug: req.tenant && req.tenant.slug })) })),

  // ── Engine: messages ──
  thread: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listThread(c, req.query)) })),
  message: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getMessage(c, req.params.id)) })),
  attachments: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listAttachments(c, req.params.id)) })),
  clientTimeline: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.clientTimeline(c, { client_id: req.params.id, limit: req.query.limit })) })),
  linkThread: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.linkEntity(c, { inboundId: req.params.id, entity_ref: req.body && req.body.entity_ref })) })),
  markRead: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.markRead(c, req.params.id)) })),
  send: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.send(c, { ...req.body, actor: actor(req) })) })),
  reply: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.reply(c, { ...req.body, connectionId: req.body.connectionId, inboundId: req.params.id, actor: actor(req) })) })),

  // ── Microsoft 365 OAuth (start is authed; callback + webhook are pre-auth) ──
  msOAuthStart: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.startMicrosoftOAuth(c, { slug: slugOf(req), redirectUri: msRedirect(req), display_name: req.query.display_name, actor: actor(req) })) })),
  msOAuthCallback: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.completeMicrosoftOAuth(c, { code: req.query.code, state: req.query.state, slug: slugOf(req), webhookUrl: msWebhook(req) })) })),
  msWebhook: asyncHandler(async (req, res) => {
    if (req.query && req.query.validationToken) return res.type("text/plain").status(200).send(req.query.validationToken);
    const data = await req.tenantDb((c) => service.handleGraphNotification(c, req.body, { slug: slugOf(req) }));
    return res.status(202).json({ data });
  }),

  // ── Google Gmail OAuth (start authed; callback pre-auth) ──
  ggOAuthStart: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.startGoogleOAuth(c, { slug: slugOf(req), redirectUri: ggRedirect(req), display_name: req.query.display_name, actor: actor(req) })) })),
  ggOAuthCallback: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.completeGoogleOAuth(c, { code: req.query.code, state: req.query.state, slug: slugOf(req) })) })),
  ggWebhook: asyncHandler(async (req, res) => {
    await req.tenantDb((c) => service.handleGmailNotification(c, req.body));
    return res.status(204).send(); // ack the Pub/Sub push
  }),
};
