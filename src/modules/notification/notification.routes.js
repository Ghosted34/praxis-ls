/** Notifications — the caller's own inbox (self-scoped; no MOD grant needed to
 *  read your own). System-generated only; no create/delete via API. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const controller = require("./notification.controller");
const validator = require("./notification.validator");
const { makeLimiter } = require("../../shared/http/rate-limit");

const router = express.Router();

/**
 * Push-subscription ROTATION — the one route here that is deliberately public.
 *
 * The caller is a service worker reacting to `pushsubscriptionchange`. It holds
 * no session: this product authenticates with a Bearer token kept in the page
 * (lib/token-store), and a worker cannot read it. Before this existed the
 * repair had to wait for the user to next open the app — and the reason they
 * were not opening it was that their notifications had stopped.
 *
 * Authorised entirely by a single-use rotation token, issued at subscribe time
 * and stored only as a SHA-256 (migration 12752). Rate-limited because an
 * unauthenticated endpoint that looks anything up by a secret must not also be
 * a place to try secrets at volume, and the service answers identically for an
 * unknown token, a spent one and a deleted subscription so it cannot be used as
 * an oracle.
 *
 * Registered BEFORE `router.use(authMiddleware)` — order is what makes it
 * public, so this block must stay above that line.
 */
const rotateLimiter = makeLimiter({ name: "push-rotate", max: 20, windowMs: 60 * 60 * 1000 });
router.post("/push/rotate", rotateLimiter, validator.pushRotate, controller.rotatePush);

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
// How many devices the caller can actually be reached on. 0 while permission
// is granted is the "this device went quiet" case the Settings banner shows.
router.get("/push/devices", controller.devices);
router.post("/read-all", controller.markAllRead);
router.post("/:id/read", controller.markRead);

module.exports = { basePath: "/notifications", feature: null, router };
