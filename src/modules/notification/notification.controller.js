"use strict";
const service = require("./notification.service");
const { asyncHandler } = require("../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  mine: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.mine(c, actor(req), req.query)) })),
  unreadCount: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.unreadCount(c, actor(req))) })),
  markRead: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.markRead(c, { id: req.params.id, actor: actor(req) })) })),
  markAllRead: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.markAllRead(c, actor(req))) })),
  categories: asyncHandler(async (_req, res) => res.json({ data: service.listCategories() })),
  getPreferences: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getPreferences(c, actor(req))) })),
  setPreferences: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setPreferences(c, { actor: actor(req), prefs: req.body.preferences })) })),
  pushPublicKey: asyncHandler(async (_req, res) => res.json({ data: await service.pushPublicKey() })),
  subscribePush: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.subscribePush(c, actor(req), { subscription: req.body.subscription, userAgent: req.headers["user-agent"] })) })),
  unsubscribePush: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.unsubscribePush(c, actor(req), { endpoint: req.body.endpoint })) })),
};
