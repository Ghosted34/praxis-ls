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

// directory + cross-channel reads
router.get("/colleagues", view, c.colleagues);
router.get("/unread", view, c.unread);
router.get("/starred", view, c.starred);
router.get("/search", view, c.search);
router.get("/quick-replies", view, c.listQuickReplies);
router.post("/quick-replies", create, v.quickReply, c.createQuickReply);
router.patch("/quick-replies/:id", create, c.updateQuickReply);
router.delete("/quick-replies/:id", create, c.deleteQuickReply);

// channels
router.get("/channels", view, c.listChannels);
router.post("/channels", create, v.channel, c.createChannel);
router.get("/channels/:id", view, c.getChannel);
router.post("/channels/:id/archive", view, c.archive);
router.get("/channels/:id/members", view, c.members);
router.post("/channels/:id/members", view, v.member, c.addMember);
router.delete("/channels/:id/members/:userId", view, c.removeMember);
router.post("/channels/:id/pin", view, c.pin);
router.post("/channels/:id/mute", view, c.mute);
router.post("/channels/:id/read", view, c.markRead);
router.get("/channels/:id/draft", view, c.getDraft);
router.put("/channels/:id/draft", view, v.draft, c.saveDraft);
router.delete("/channels/:id/draft", view, c.clearDraft);
router.post("/channels/:id/certify", requirePermission(M, "approve"), c.certify);

// messages
router.get("/channels/:id/messages", view, c.thread);
router.post("/channels/:id/messages", create, v.message, c.post);
router.patch("/messages/:messageId", view, v.editMessage, c.edit);
router.delete("/messages/:messageId", view, c.del);
router.post("/messages/:messageId/react", view, v.react, c.react);
router.post("/messages/:messageId/star", view, c.star);

module.exports = { basePath: "/smartcomm", feature: "comms", router };
