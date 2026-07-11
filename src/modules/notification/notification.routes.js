/** Notifications — the caller's own inbox (self-scoped; no MOD grant needed to
 *  read your own). System-generated only; no create/delete via API. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const controller = require("./notification.controller");

const router = express.Router();
router.use(authMiddleware);
router.get("/", controller.mine);
router.get("/unread-count", controller.unreadCount);
router.post("/read-all", controller.markAllRead);
router.post("/:id/read", controller.markRead);

module.exports = { basePath: "/notifications", feature: null, router };
