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
  /*
   * ── PUSH SUBSCRIPTIONS ARE IDENTITY, NOT BUSINESS DATA ───────────────────
   *
   * These four use `identityDb` (always the LIVE schema), not `tenantDb`
   * (whichever schema X-Praxis-Env names). tenant-context.js states the rule
   * and names this case in so many words: "auth, sessions, DEVICES, 2FA, users
   * and the RBAC grant matrix always resolve against the LIVE/identity schema
   * regardless of X-Praxis-Env". A registered browser is a device.
   *
   * It was `tenantDb`, and that was a silent way to lose notifications: a user
   * who happened to be in TEST when they enabled push had their subscription
   * written to the sandbox schema, while every notification producer that
   * matters — the mail sync above all — runs against live and reads the live
   * table. Their phone was registered, the toggle said "on", and nothing was
   * ever sent to it. Nothing anywhere reported that.
   */
  subscribePush: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.subscribePush(c, actor(req), { subscription: req.body.subscription, userAgent: req.headers["user-agent"] })) })),
  unsubscribePush: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.unsubscribePush(c, actor(req), { endpoint: req.body.endpoint })) })),
  devices: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.pushDevices(c, actor(req))) })),
  /*
   * identityDb for the same reason as the four above — a registered browser is
   * a device, and devices live in LIVE regardless of X-Praxis-Env. It matters
   * more here than anywhere: a test run from Test that read the sandbox table
   * would report "no registered devices" to somebody whose device is registered
   * perfectly well, which is the exact confusion this route exists to end.
   */
  testPush: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.sendPushTest(c, actor(req))) })),
  // No `actor` — this one has no caller identity to read. The rotation token is
  // the whole authorisation, and the tenant comes from the Host header like
  // every other tenant-scoped request. identityDb for the reason above, and it
  // is also what lets the service worker call this with no environment header.
  rotatePush: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.rotatePush(c, {
      rotationToken: req.body.rotation_token,
      subscription: req.body.subscription,
    })),
  })),
};
