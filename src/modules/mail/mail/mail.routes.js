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
const { requireFeature } = require("../../../middleware/feature-gate");
const c = require("./mail.controller");
const v = require("./mail.validator");

const {
  requireVisibleThread,
  requireVisibleMessage,
  requireVisibleAttachment,
} = require("./visible");

const M = "MOD-72";
const router = express.Router();

/**
 * ── THE TWO FLAGS THAT GATE PR-1 ────────────────────────────────────────────
 *
 * `mail.core` and `mail.composer` are seeded by `10730_mail_defaults_and_flags`
 * and, until this line, gated nothing: 71 routes in this file, `feature: null`
 * at the bottom, and not one `requireFeature` anywhere. Q5 is explicit that
 * every mail surface is "all on for Smart Logistics, off for every other
 * tenant" — so a flag nobody checks meant every tenant on the deployment had
 * the mailbox, the composer and the send queue live regardless of what their
 * `feature_state` said. The Platform Console projected OFF and the API answered
 * anyway, which is the worst kind of gate: visible, trusted and inert.
 *
 * Applied per SECTION rather than to the whole router, because this file also
 * carries PR-0's setup surface — connections, mailboxes, catalogue, send points
 * — and that MUST stay reachable while the flags are off. Otherwise an admin
 * cannot configure mail for the tenant they are about to enable it for, and the
 * first thing the feature does is lock them out of turning it on.
 *
 * `requireFeature` fails CLOSED on a missing row, which is the right direction:
 * a tenant provisioned before the flag existed gets no mailbox rather than an
 * ungoverned one.
 */
const core = requireFeature("mail.core");
const composer = requireFeature("mail.composer");

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
router.get("/sent", core, requirePermission(M, "view"), c.sent);
/* C-3. Still mounted, now scoped. `mail.repo.listInbox` applies `accessible` +
 * the §9.5 predicate and computes `is_read` per caller; before that it was
 * `WHERE direction = 'IN'` and nothing else, so this route listed every inbound
 * message in the tenant to any mail user and the live "Message log" tab
 * rendered it. The endpoint's response shape is unchanged. */
router.get("/inbox", core, requirePermission(M, "view"), c.inbox);
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

/* ── PR-1A: conversations ─────────────────────────────────────────────────
 *
 * The conversation is the unit the UI works in; a message is what a
 * conversation is made of. Everything below is keyed on an email_thread_id.
 *
 * Action mapping, same discipline as above:
 *
 *   view    listing conversations, opening one, listing folders and labels.
 *   edit    read state, stars, moves, stream corrections, labelling, and bulk
 *           forms of all of those. They change how mail is organised, not what
 *           correspondence exists.
 *   create  making a label — it is a new object the user owns.
 *
 * Read state, stars and labels are PER USER, so every handler takes the actor.
 * Which conversations a caller may see at all is decided a second time inside
 * the repo, by the same access predicate the mailbox grants drive: MOD-72 says
 * whether you may touch mail, the grants say whose mail.
 *
 * Search has no endpoint of its own on purpose. It is `GET /threads?q=`, so a
 * search result IS a conversation list and every filter, sort and bulk action
 * keeps working on it — an inbox that behaves differently once you type in the
 * box is two inboxes to maintain. */

/* The conversation routes below reach `thread.service`, which already reads
 * through `repo.getThread` and so already carries §9.5 — these gates are not
 * closing an open hole the way binding/triage/assist's were. They are here so
 * the invariant is UNIFORM: `mail-route-visibility.test.js` asserts that every
 * thread-scoped route carries a gate, and an invariant with "except the ones
 * whose service happens to be correct" in it is not one a future author can
 * apply without reading every service first. The cost is one indexed head read.
 *
 * Static paths BEFORE `/threads/:id`, or Express matches "folders" as an id. */
router.get("/folders", core, requirePermission(M, "view"), c.mailFolders);
router.get("/labels", core, requirePermission(M, "view"), c.mailLabels);
router.post("/labels", core, requirePermission(M, "create"), v.label, c.createLabel);
router.delete("/labels/:id", core, requirePermission(M, "edit"), c.deleteLabel);

router.get("/threads", core, requirePermission(M, "view"), c.threads);
router.post("/threads/bulk", core, requirePermission(M, "edit"), v.threadBulk, c.threadBulk);

/* ── Deletion (H-1) ───────────────────────────────────────────────────────
 *
 * `delete` rather than `edit`: removing correspondence is not a state change on
 * it. Both routes refuse anything sealed into the archive chain and ledger the
 * attempt — see thread.service.remove for why the refusal is the feature. */
router.delete("/threads/:id", core, requirePermission(M, "delete"), requireVisibleThread(), c.threadDelete);
router.post("/folders/empty", core, requirePermission(M, "delete"), v.folderEmpty, c.folderEmpty);

/* ── Inbound attachments (H-2) ────────────────────────────────────────────
 *
 * §5.4's download route did not exist — no route, no handler, no client call —
 * so the reading pane rendered an "Attachment" pill and there was no way to
 * open the bill of lading that had just arrived. Acceptance criterion 8 was
 * half met: storage and hashing yes, retrieval no.
 *
 * `requireVisibleAttachment` resolves the attachment to its thread and applies
 * the §9.5 predicate, so an attachment on a conversation the caller cannot see
 * is a 404 — the same answer as one that does not exist. */
router.get("/attachments/:attachmentId/download", core, requirePermission(M, "view"),
  requireVisibleAttachment("attachmentId"), c.downloadAttachment);
router.get("/threads/:id", core, requirePermission(M, "view"), requireVisibleThread(), c.threadGet);
router.post("/threads/:id/read", core, requirePermission(M, "edit"), requireVisibleThread(), v.threadFlag, c.threadRead);
router.post("/threads/:id/star", core, requirePermission(M, "edit"), requireVisibleThread(), v.threadFlag, c.threadStar);
router.post("/threads/:id/move", core, requirePermission(M, "edit"), requireVisibleThread(), v.threadMove, c.threadMove);
router.post("/threads/:id/stream", core, requirePermission(M, "edit"), requireVisibleThread(), v.threadStream, c.threadStream);
router.post("/threads/:id/label", core, requirePermission(M, "edit"), requireVisibleThread(), v.labelApply, c.threadLabel);

/* ── Engine: messages (pre-PR-1A) ─────────────────────────────────────────
 *
 * `/thread` (singular) is the OLD flat message list, kept because the current
 * client still calls it and PR-1B replaces those call sites. `/threads`
 * (plural) above is the conversation model. They are deliberately different
 * paths rather than one path with a mode flag, so the old one can be deleted in
 * one commit when nothing calls it. */
router.get("/thread", core, requirePermission(M, "view"), c.thread);
/* P1A-1/P1A-2, the same class as C-4 on the legacy surface: the flat detail
 * read was scoped to accessible CONNECTIONS but not to thread visibility, so
 * inside a shared mailbox it opened a thread the new surface would 404. */
router.get("/thread/:id", core, requirePermission(M, "view"), requireVisibleMessage("id"), c.message);
router.get("/thread/:id/attachments", core, requirePermission(M, "view"), requireVisibleMessage("id"), c.attachments);
router.get("/client/:id/timeline", core, requirePermission(M, "view"), c.clientTimeline);
router.post("/thread/:id/link", core, requirePermission(M, "create"), requireVisibleMessage("id"), v.threadLink, c.linkThread);
router.post("/thread/:id/read", core, requirePermission(M, "edit"), requireVisibleMessage("id"), c.markRead);
/* ── PR-1B: composing ─────────────────────────────────────────────────────
 *
 * Action mapping:
 *
 *   create  sending, and saving a draft. A draft is correspondence in progress
 *           and becomes correspondence; someone who may not send should not be
 *           able to compose either, or the button is a trap.
 *   view    reading your own drafts and your own outbox.
 *   edit    cancelling a send and discarding a draft — they change something
 *           that already exists rather than producing new correspondence.
 *
 * Every one of these is scoped to the CALLER inside the service, not to the
 * mailbox. Holding a grant on billing@ is authority to send from it; it is not
 * authority to read what a colleague is still deciding whether to say. */

router.get("/drafts", composer, requirePermission(M, "view"), c.listDrafts);
router.post("/drafts", composer, requirePermission(M, "create"), v.draft, c.saveDraft);
router.get("/drafts/:id", composer, requirePermission(M, "view"), c.getDraft);
router.delete("/drafts/:id", composer, requirePermission(M, "edit"), c.discardDraft);

router.get("/outbox", composer, requirePermission(M, "view"), c.outbox);

// Queues; it does not send. The response says when the message will actually go.
router.post("/send", composer, requirePermission(M, "create"), v.send, c.send);
// Undo. Succeeds only while the row is still HELD — the database decides the
// race against the flusher, so this is a 409 rather than a lie once it has gone.
router.post("/send/:id/cancel", composer, requirePermission(M, "edit"), c.cancelSend);

// Attachments live under their draft, because that is what owns them and what
// authorises them: the service checks the draft is the caller's before it will
// list, add or remove anything.
router.get("/drafts/:id/attachments", composer, requirePermission(M, "view"), c.draftAttachments);
router.post("/attachments/upload", composer, requirePermission(M, "create"), v.attachmentUpload, c.uploadAttachment);
router.post("/attachments/from-vault", composer, requirePermission(M, "create"), v.attachmentFromVault, c.attachFromVault);
router.delete("/drafts/:id/attachments/:attachmentId", composer, requirePermission(M, "edit"), c.removeAttachment);

/* Slash commands.
 *
 * Gated on MOD-72 like everything else here — that decides whether you may use
 * the composer at all. WHICH commands you may run is a second question, answered
 * per command against the module that owns the data, inside the service. A
 * clerk who may compose mail but not open Treasury gets the composer and not
 * `/bank`. */
router.get("/commands", composer, requirePermission(M, "view"), c.commands);
router.post("/commands/:key", composer, requirePermission(M, "view"), v.runCommand, c.runCommand);
/* `:id` here is a MESSAGE id (legacy flat surface), so this is the message gate,
 * not the thread one. Replying to a message quotes it, so a reply to something
 * the caller cannot see would hand them the text they could not read. */
router.post("/thread/:id/reply", composer, requirePermission(M, "create"), requireVisibleMessage("id"), v.reply, c.reply);

module.exports = { basePath: "/mail", feature: null, router };
