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
const { z } = require("zod");
const { body } = require("../../shared/http/validate");
const service = require("./branding.service");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./branding.controller");
const validator = require("./branding.validator");

/**
 * SEC H3. The controller reads exactly one field (`req.body.dataUrl`) and never
 * spreads the body into a repo write, so there was no mass-assignment risk —
 * but "safe because the controller happens to name one field" is precisely the
 * reasoning this guard exists to stop relying on. A schema states the contract
 * instead of leaving it to be re-derived by the next reader.
 *
 * The cap is a size bound, not a format check: a data URL is base64 and an
 * unbounded one is a memory-exhaustion vector on an authenticated write.
 */
const validateAppIcon = body(z.object({
  dataUrl: z.string().min(1).max(4_000_000),
}));

/**
 * SEC H3. `putPwa` spreads `...req.body` into `service.setPwa`, which filters
 * to `PWA_KEYS` — so no unknown key ever reaches a write. That is safe, and it
 * is safe for a reason a reader has to go and verify in another file.
 *
 * The schema is BUILT FROM PWA_KEYS rather than retyped, so the two cannot
 * drift: adding a PWA setting to the service automatically makes it accepted
 * here, and nothing else is. `.strict()` is the whole point — it refuses an
 * unrecognised key at the edge instead of relying on the service to ignore it.
 *
 * Values stay `z.any()` deliberately: `normalisePwaField` already coerces and
 * bounds each field by name, and duplicating those rules here would be a second
 * source of truth for exactly the thing this comment is about.
 */
const validatePwa = body(
  z.object(Object.fromEntries(
    Object.keys(service.PWA_KEYS).map((k) => [k, z.any().optional()]),
  )).strict(),
);

const router = express.Router();
router.get("/", controller.get);
router.put("/", authMiddleware, requirePermission("MOD-70", "edit"), validator.put, controller.put);
router.post("/logo", authMiddleware, requirePermission("MOD-70", "edit"), validator.upload, controller.uploadLogo);

// Login screen editor (3.2). GET is PUBLIC (login page reads it pre-auth);
// write + background upload are gated the same as branding.
router.get("/login", controller.getLogin);
router.put("/login", authMiddleware, requirePermission("MOD-70", "edit"), validator.putLogin, controller.putLogin);
router.post("/login/background", authMiddleware, requirePermission("MOD-70", "edit"), validator.upload, controller.uploadLoginBackground);

// Installed-app (PWA) design — manifest identity, home-screen icon, boot splash
// and the install/offline copy. GET is PUBLIC (the boot splash paints pre-auth);
// write + icon upload are gated exactly like appearance.
router.get("/pwa", controller.getPwa);
router.put("/pwa", authMiddleware, requirePermission("MOD-70", "edit"), validatePwa, controller.putPwa);
router.post("/pwa/icon", authMiddleware, requirePermission("MOD-70", "edit"), validateAppIcon, controller.uploadAppIcon);

module.exports = { basePath: "/branding", feature: null, router };
