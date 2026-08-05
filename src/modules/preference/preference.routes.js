/**
 * Per-user preference routes — the self-service surface, mounted at
 * /api/tenant/me/*.
 *
 *   GET    /me/preferences/appearance     this user's typography overrides
 *   PUT    /me/preferences/appearance     partial update; null clears a token
 *   DELETE /me/preferences/appearance     clear all three → tenant default
 *   GET    /me/preferences/shell          ribbon + icon-rail arrangement
 *   PUT    /me/preferences/shell          partial update; null clears a key
 *
 * The shell section has no DELETE. "Reset the rail" is `railPins: null`, which
 * the partial PUT already expresses, and a section-wide reset would also clear
 * the one-time rail hint — re-teaching someone a thing they have already
 * learned, every time they tidy their shortcuts.
 *
 * AUTHENTICATED, BUT NOT PERMISSION-GATED — and that is the point. Tenant
 * branding sits behind MOD-70 edit because it changes what everyone sees;
 * these rows change what exactly one person sees, and that person is the
 * caller. Requiring a grant would mean an operator needs Settings-edit — a
 * permission that also lets them rewrite the company's brand — to enlarge their
 * own body font. There is no id in the path for the same reason: the subject is
 * always req.user, so no request can address another user's preferences.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const controller = require("./preference.controller");
const { validateAppearance, validateShell } = require("./preference.validator");

const router = express.Router();
router.use(authMiddleware);

router.get("/preferences/appearance", controller.getAppearance);
router.put("/preferences/appearance", validateAppearance, controller.putAppearance);
router.delete("/preferences/appearance", controller.resetAppearance);

router.get("/preferences/shell", controller.getShell);
router.put("/preferences/shell", validateShell, controller.putShell);

module.exports = { basePath: "/me", feature: null, router };
