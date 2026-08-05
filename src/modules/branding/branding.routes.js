/**
 * White-label branding routes.
 *   GET  /api/tenant/branding   PUBLIC — the login screen needs the tenant's
 *                               colour/logo before anyone authenticates, so this
 *                               is intentionally ungated (read-only, resolved by
 *                               Host like /whoami).
 *   PUT  /api/tenant/branding   GATED  — authMiddleware + MOD-70 (Settings) edit.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./branding.controller");

const router = express.Router();
router.get("/", controller.get);
router.put("/", authMiddleware, requirePermission("MOD-70", "edit"), controller.put);
router.post("/logo", authMiddleware, requirePermission("MOD-70", "edit"), controller.uploadLogo);

// Login screen editor (3.2). GET is PUBLIC (login page reads it pre-auth);
// write + background upload are gated the same as branding.
router.get("/login", controller.getLogin);
router.put("/login", authMiddleware, requirePermission("MOD-70", "edit"), controller.putLogin);
router.post("/login/background", authMiddleware, requirePermission("MOD-70", "edit"), controller.uploadLoginBackground);

// Installed-app (PWA) design — manifest identity, home-screen icon, boot splash
// and the install/offline copy. GET is PUBLIC (the boot splash paints pre-auth);
// write + icon upload are gated exactly like appearance.
router.get("/pwa", controller.getPwa);
router.put("/pwa", authMiddleware, requirePermission("MOD-70", "edit"), controller.putPwa);
router.post("/pwa/icon", authMiddleware, requirePermission("MOD-70", "edit"), controller.uploadAppIcon);

module.exports = { basePath: "/branding", feature: null, router };
