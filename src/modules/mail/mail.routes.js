/** Mail — per-purpose sender identities + outbound log (read-only view), PLUS the
 *  provider-agnostic engine (Phase 1: IMAP/SMTP): connect / test / sync / thread /
 *  send / reply. See doc/EMAIL_ENGINE_PLAN.md. feature:null keeps the module always
 *  mounted (unchanged); a dedicated `mail` feature_state key can gate it later. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const c = require("./mail.controller");
const v = require("./mail.validator");
const router = express.Router();

// Pre-auth: Microsoft calls these directly (browser redirect after consent; Graph
// change-notification webhook). The tenant is resolved from the subdomain host by
// tenantContext; CSRF + user identity ride in the signed OAuth `state`, and the
// webhook echoes Graph's validationToken. Declared BEFORE authMiddleware.
router.get("/oauth/microsoft/callback", c.msOAuthCallback);
router.post("/webhook/microsoft", c.msWebhook);
router.get("/oauth/google/callback", c.ggOAuthCallback);
router.post("/webhook/google", c.ggWebhook);

router.use(authMiddleware);

// OAuth connect (user-initiated from Settings)
router.get("/oauth/microsoft/start", c.msOAuthStart);
router.get("/oauth/google/start", c.ggOAuthStart);

// Read-only view (original)
router.get("/senders", c.senders);
router.get("/sent", c.sent);
router.get("/inbox", c.inbox);
router.patch("/senders/:id", c.updateSender);
router.post("/senders", c.upsertSender);

// Engine: connections
router.get("/autodiscover", c.autodiscover);
router.get("/connections", c.listConnections);
router.post("/connections", v.connect, c.connect);
router.post("/connections/:id/test", c.testConnection);
router.post("/connections/:id/sync", c.syncNow);

// Engine: messages
router.get("/thread", c.thread);
router.get("/thread/:id", c.message);
router.get("/thread/:id/attachments", c.attachments);
router.get("/client/:id/timeline", c.clientTimeline);
router.post("/thread/:id/link", c.linkThread);
router.post("/thread/:id/read", c.markRead);
router.post("/send", v.send, c.send);
router.post("/thread/:id/reply", v.reply, c.reply);

module.exports = { basePath: "/mail", feature: null, router };
