/** Notifications — the caller's own inbox (self-scoped; no MOD grant needed to
 *  read your own). System-generated only; no create/delete via API. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const controller = require("./notification.controller");
const validator = require("./notification.validator");

const router = express.Router();
router.use(authMiddleware);
router.get("/", controller.mine);
router.get("/unread-count", controller.unreadCount);
// Self-service preferences (no MOD grant — you manage your own). Literal path,
// registered before the /:id route so it can't be captured as an :id.
router.get("/categories", controller.categories);
router.get("/preferences", controller.getPreferences);
router.put("/preferences", validator.preferences, controller.setPreferences);
// Web-Push opt-in. Literal /push/* paths, registered before the /:id route so
// they can't be captured as an :id. public-key is a read; subscribe/unsubscribe
// persist (or remove) this browser's PushSubscription for the caller.
router.get("/push/public-key", controller.pushPublicKey);
router.post("/push/subscribe", validator.pushSubscribe, controller.subscribePush);
router.delete("/push/subscribe", validator.pushUnsubscribe, controller.unsubscribePush);
router.post("/read-all", controller.markAllRead);
router.post("/:id/read", controller.markRead);

module.exports = { basePath: "/notifications", feature: null, router };
