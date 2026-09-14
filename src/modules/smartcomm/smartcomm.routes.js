/** Smart Comms (MOD-64) — corporate WhatsApp-style. Gated; feature comms.
 *  Membership is enforced in the service (you only see channels you belong to). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const c = require("./smartcomm.controller");
const v = require("./smartcomm.validator");
const { singleFile } = require("../../shared/http/upload.middleware");

const M = "MOD-64";
const view = requirePermission(M, "view");
const create = requirePermission(M, "create");
const router = express.Router();
router.use(authMiddleware);

// outbound provider config (WhatsApp / email) — set + live test. Writes/tests
// decrypt + call out, so they are gated on create; the read is redacted.
router.get("/config", view, c.getCommsConfig);
router.put("/config/whatsapp", create, v.whatsappConfig, c.setWhatsapp);
router.put("/config/email", create, v.emailConfig, c.setEmail);
router.post("/config/whatsapp/test", create, c.testWhatsapp);
router.post("/config/email/test", create, v.emailTest, c.testEmail);
// Mail-setup wizard (Comms → Setup guide). dns-check reads PUBLIC DNS — a
// read, gated `view`; test-send sends a real message through the tenant's
// transport — a write with side effects, gated `create` like the other tests.
router.post("/config/email/dns-check", view, v.emailDnsCheck, c.dnsCheck);
router.post("/config/email/test-send", create, v.emailTestSend, c.testSend);

// directory + cross-channel reads
router.get("/colleagues", view, c.colleagues);
router.get("/unread", view, c.unread);
router.get("/starred", view, c.starred);
router.get("/search", view, c.search);
router.get("/quick-replies", view, c.listQuickReplies);
router.post("/quick-replies", create, v.quickReply, c.createQuickReply);
router.patch("/quick-replies/:id", create, v.quickReplyPatch, c.updateQuickReply);
router.delete("/quick-replies/:id", create, c.deleteQuickReply);

/**
 * API F-22 — the declared RBAC action must describe what the endpoint DOES.
 *
 * Eight write endpoints were gated on `view`, so granting a role "MOD-64: view"
 * also granted "add and remove channel members" and "archive a channel". An
 * administrator configuring the permission matrix had no way to know that; the
 * matrix said read and the routes meant write.
 *
 * Two kinds of write are distinguished here, because they are genuinely
 * different rights and collapsing them would be its own inaccuracy:
 *
 *   `edit`   — changes something OTHER PEOPLE see: channel membership, the
 *              archived flag, another message's content or existence.
 *   `view`   — changes only the CALLER'S OWN relationship to a channel: their
 *              pin, their mute, their read marker, their draft, their star,
 *              their reaction. These are per-user rows keyed on the caller and
 *              are meaningless to anyone else, so requiring a write grant to
 *              mute a channel you can already read would be the opposite
 *              mistake. They keep `view`, now deliberately and in writing.
 *
 * Membership remains the real authorisation in every case — `assertMember` in
 * the service — and that is unchanged. This is about the permission matrix
 * telling the truth.
 */
const edit = requirePermission(M, "edit");

// channels
router.get("/channels", view, c.listChannels);
router.post("/channels", create, v.channel, c.createChannel);
router.get("/channels/:id", view, c.getChannel);
router.post("/channels/:id/archive", edit, v.flag, c.archive);
router.get("/channels/:id/members", view, c.members);
router.post("/channels/:id/members", edit, v.member, c.addMember);
router.delete("/channels/:id/members/:userId", edit, c.removeMember);
// Own-preference writes: per-user rows keyed on the caller. See the note above.
router.post("/channels/:id/pin", view, v.flag, c.pin);
router.post("/channels/:id/mute", view, v.flag, c.mute);
router.post("/channels/:id/read", view, c.markRead);
router.get("/channels/:id/draft", view, c.getDraft);
router.put("/channels/:id/draft", view, v.draft, c.saveDraft);
router.delete("/channels/:id/draft", view, c.clearDraft);
router.post("/channels/:id/certify", requirePermission(M, "approve"), c.certify);

/**
 * Attachments, chat media and ERP references.
 *
 * `create`, not `view`: an upload writes bytes into tenant storage and a row
 * into the database, and the gate must say so. Membership is still the real
 * authorisation — `assertMember` in the service — for the same reason it is
 * everywhere else in this module.
 *
 * `singleFile` must run BEFORE the validator: a multipart body is parsed by
 * multer, so without it `req.body` is empty and every field 422s.
 */
router.post("/channels/:id/media", create, singleFile("file"), v.mediaUpload, c.uploadMedia);
// Reading one attachment is a read of the conversation it belongs to. NOT the
// unauthenticated /media/<key> static mount — see the controller.
router.get("/media/:mediaId", view, c.mediaBytes);
// "Save to vault" files a chat image as a real document, which is a write other
// people see: it appears in the document register for everyone with vault
// rights, and it is meant to.
router.post("/media/:mediaId/promote", edit, v.promote, c.promoteMedia);
/**
 * "Transcribe this voice note" — `view`, deliberately, and here is why.
 *
 * It writes a row other people see, which by the rule stated above reads like
 * `edit`. It is gated on `view` anyway, because what it produces is not new
 * content: it is the words that are ALREADY in a message the caller is allowed
 * to play, in a form they can read. Requiring a write grant would mean a
 * warehouse role with read access can hear every voice note in its channel and
 * is the one kind of member who can never read one — which is the accessibility
 * hole the transcript exists to close, reinstated by the permission matrix.
 *
 * Membership is the real authorisation, asserted in the media service, and it
 * matters more here than on most reads: this endpoint spends money on the
 * tenant's provider account.
 */
router.post("/media/:mediaId/transcribe", view, v.transcribe, c.transcribeMedia);
// Both reads, and both resolve against the CALLER's permissions rather than the
// sender's — a member without MOD-51 gets the reference and no figure. MOD-64
// `view` is the gate to reach them at all; the per-record rights are applied
// inside. See smartcomm.erp.service.js.
router.get("/erp/search", view, c.erpSearch);
router.get("/erp/:kind/:id", view, c.erpCard);

// Durable scheduled messages (personal management, never other senders' rows).
router.get("/channels/:id/scheduled", view, c.scheduled);
router.post("/channels/:id/scheduled", create, v.scheduled, c.schedule);
router.patch("/scheduled/:id", create, v.reschedule, c.reschedule);
router.delete("/scheduled/:id", view, c.cancelScheduled);

// messages
router.get("/channels/:id/messages", view, c.thread);
router.post("/channels/:id/messages", create, v.message, c.post);
// Editing and deleting a message is a write to shared content. Sender-ownership
// is still asserted in the service on top of this.
router.patch("/messages/:messageId", edit, v.editMessage, c.edit);
router.delete("/messages/:messageId", edit, c.del);
// Own-preference writes again: a reaction and a star are rows keyed on the caller.
router.post("/messages/:messageId/react", view, v.react, c.react);
// G22 — acknowledge a message (read receipt on a directive). Any member may
// acknowledge; the sender sees acknowledged_by/acknowledged_at on the row.
router.post("/messages/:messageId/acknowledge", view, c.ack);
router.post("/messages/:messageId/star", view, c.star);

module.exports = { basePath: "/smartcomm", feature: "comms", router };
