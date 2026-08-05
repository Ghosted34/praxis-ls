/** Smart Comms (MOD-64) — corporate WhatsApp-style. Gated; feature comms.
 *  Membership is enforced in the service (you only see channels you belong to). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const c = require("./smartcomm.controller");
const v = require("./smartcomm.validator");

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

// messages
router.get("/channels/:id/messages", view, c.thread);
router.post("/channels/:id/messages", create, v.message, c.post);
// Editing and deleting a message is a write to shared content. Sender-ownership
// is still asserted in the service on top of this.
router.patch("/messages/:messageId", edit, v.editMessage, c.edit);
router.delete("/messages/:messageId", edit, c.del);
// Own-preference writes again: a reaction and a star are rows keyed on the caller.
router.post("/messages/:messageId/react", view, v.react, c.react);
router.post("/messages/:messageId/star", view, c.star);

module.exports = { basePath: "/smartcomm", feature: "comms", router };
