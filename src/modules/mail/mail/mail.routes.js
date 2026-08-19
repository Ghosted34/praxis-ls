/** Mail — per-purpose sender identities + outbound log (read-only view), PLUS the
 *  provider-agnostic engine (Phase 1: IMAP/SMTP): connect / test / sync / thread /
 *  send / reply. See doc/EMAIL_ENGINE_PLAN.md. feature:null keeps the module always
 *  mounted (unchanged); a dedicated `mail` feature_state key can gate it later.
 *
 *  RBAC (added 2026-08-02, doc/ORGANOGRAMME_AUDIT_2026-08-02.md finding C2). Until
 *  now every route below sat behind authMiddleware and NOTHING else, so the lowest-
 *  privilege user in the tenant could read the whole inbox, any thread and its
 *  attachments, any client's full correspondence timeline, and send mail AS the
 *  company mailbox. Gated on MOD-72 (Mail & Correspondence), seeded in
 *  migrations/seeds/9130_mail_module.sql with default grants in 9022.
 *
 *  Why its own key rather than riding MOD-64 (Smart Comms) as smartcomm.routes.js
 *  does: MOD-64 is internal staff messaging, this is external client correspondence
 *  plus the credentials to send as the company. Granting one must not grant the
 *  other. The key is catalogued so it appears in the permission matrix — a key that
 *  is absent from platform.module_catalogue has grants for nobody and 403s every
 *  non-CEO user (the MOD-29 lesson, session 17).
 *
 *  Action mapping: reads → view; sending, replying and linking a thread to a record
 *  → create (they produce correspondence); marking read → edit; mailbox connection
 *  management → edit, because a connection holds credentials and rebinding one
 *  redirects the company's mail. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./mail.controller");
const v = require("./mail.validator");

const M = "MOD-72";
const router = express.Router();

// Pre-auth: Microsoft calls these directly (browser redirect after consent; Graph
// change-notification webhook). The tenant is resolved from the subdomain host by
// tenantContext; CSRF + user identity ride in the signed OAuth `state`, and the
// webhook echoes Graph's validationToken. Declared BEFORE authMiddleware.
router.get("/oauth/microsoft/callback", c.msOAuthCallback);
// Graph's subscription-reachability test POSTs an EMPTY body with the token in
// the query string. Echo it back BEFORE the body validator runs — otherwise the
// `value`-requiring msWebhook schema 422s the test and the subscription never
// validates. Real notifications (with a body) fall through to validate + handle.
router.post(
  "/webhook/microsoft",
  (req, res, next) => (req.query && req.query.validationToken
    ? res.type("text/plain").status(200).send(String(req.query.validationToken))
    : next()),
  v.msWebhook,
  c.msWebhook,
);
router.get("/oauth/google/callback", c.ggOAuthCallback);
router.post("/webhook/google", v.ggWebhook, c.ggWebhook);

router.use(authMiddleware);

// OAuth connect (user-initiated from Settings). Starting a consent flow binds a
// mailbox to the tenant, so it is a connection write, not a read.
router.get("/oauth/microsoft/start", requirePermission(M, "edit"), c.msOAuthStart);
router.get("/oauth/google/start", requirePermission(M, "edit"), c.ggOAuthStart);

// Read-only view (original)
router.get("/senders", requirePermission(M, "view"), c.senders);
router.get("/sent", requirePermission(M, "view"), c.sent);
router.get("/inbox", requirePermission(M, "view"), c.inbox);
router.patch("/senders/:id", requirePermission(M, "edit"), v.senderPatch, c.updateSender);
router.post("/senders", requirePermission(M, "create"), v.sender, c.upsertSender);
router.post("/senders/:id/archive", requirePermission(M, "edit"), c.archiveSender);

// Engine: connections
router.get("/autodiscover", requirePermission(M, "view"), c.autodiscover);
router.get("/connections", requirePermission(M, "view"), c.listConnections);
router.post("/connections", requirePermission(M, "create"), v.connect, c.connect);
router.patch("/connections/:id", requirePermission(M, "edit"), v.connectPatch, c.updateConnection);
router.post("/connections/:id/test", requirePermission(M, "edit"), c.testConnection);
router.post("/connections/:id/sync", requirePermission(M, "edit"), c.syncNow);
router.post("/connections/:id/default", requirePermission(M, "edit"), c.setDefaultMailbox);
router.get("/recipients", requirePermission(M, "view"), c.recipients);

/* ── PR-0 foundation ──────────────────────────────────────────────────────
 *
 * Action mapping, stated so the permission matrix tells the truth (the same
 * discipline the header above sets out for the engine routes):
 *
 *   view    listing mailboxes, the catalogue, send points, members, the access
 *           log, and the cPanel preset. All reads.
 *   create  standing up a NEW shared mailbox — it holds credentials and becomes
 *           an address the company sends from.
 *   edit    everything else that changes configuration: granting and revoking
 *           access, binding a send point, archiving, handover, limits. These are
 *           writes to shared state even when they touch one row.
 *
 * `/mailboxes/mine` is the one route deliberately gated only on `view`: it
 * returns the caller's OWN mailbox and the ones they have been granted, so it
 * can never disclose anything their grants do not already allow.
 *
 * Access to an individual SHARED mailbox is a second check on top of RBAC —
 * MOD-72 decides whether you may touch mail at all, access.js decides which
 * mailboxes. Both apply; the route gate runs first. */

// What the caller may do — drives which Setup sub-tabs the client draws.
router.get("/me", requirePermission(M, "view"), c.me);

// Mailbox inventory
router.get("/mailboxes/mine", requirePermission(M, "view"), c.myMailboxes);
router.get("/mailboxes", requirePermission(M, "view"), c.allMailboxes);
router.post("/mailboxes/shared", requirePermission(M, "create"), v.sharedMailbox, c.createShared);
router.post("/mailboxes/:id/archive", requirePermission(M, "edit"), c.archiveMailbox);
router.post("/mailboxes/:id/handover", requirePermission(M, "edit"), v.handover, c.handoverMailbox);
router.patch("/mailboxes/:id/limits", requirePermission(M, "edit"), v.mailboxLimits, c.setMailboxLimits);
router.get("/mailboxes/:id/allowance", requirePermission(M, "view"), c.sendAllowance);

// Shared-mailbox catalogue
router.get("/catalogue", requirePermission(M, "view"), c.catalogue);
router.post("/catalogue", requirePermission(M, "create"), v.catalogueEntry, c.addCatalogueEntry);
router.patch("/catalogue/:key", requirePermission(M, "edit"), v.catalogueToggle, c.toggleCatalogueEntry);

// Access grants
router.get("/mailboxes/:id/members", requirePermission(M, "view"), c.members);
router.post("/mailboxes/:id/members", requirePermission(M, "edit"), v.memberGrant, c.grantMember);
router.delete("/mailboxes/:id/members/:userId", requirePermission(M, "edit"), c.revokeMember);
router.get("/access-log", requirePermission(M, "view"), c.accessAudit);

// Send-point routing
router.get("/send-points", requirePermission(M, "view"), c.sendPoints);
router.put("/send-points/:key", requirePermission(M, "edit"), v.sendPointBinding, c.bindSendPoint);
router.delete("/send-points/:key", requirePermission(M, "edit"), c.unbindSendPoint);

// cPanel preset — a read that touches nothing; the first tenant runs cPanel and
// this turns a five-field form into a two-field one.
router.get("/cpanel-preset", requirePermission(M, "view"), c.cpanel);

// Engine: messages
router.get("/thread", requirePermission(M, "view"), c.thread);
router.get("/thread/:id", requirePermission(M, "view"), c.message);
router.get("/thread/:id/attachments", requirePermission(M, "view"), c.attachments);
router.get("/client/:id/timeline", requirePermission(M, "view"), c.clientTimeline);
router.post("/thread/:id/link", requirePermission(M, "create"), v.threadLink, c.linkThread);
router.post("/thread/:id/read", requirePermission(M, "edit"), c.markRead);
router.post("/send", requirePermission(M, "create"), v.send, c.send);
router.post("/thread/:id/reply", requirePermission(M, "create"), v.reply, c.reply);

module.exports = { basePath: "/mail", feature: null, router };
