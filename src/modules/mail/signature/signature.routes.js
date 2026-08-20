/**
 * Signature surfaces. Own profile is authed-only (personal preference, like
 * `preference`). Template admin is MOD-70 edit — brand governance.
 *
 * Mounted at /mail. Adding this file is what makes `mail` a GROUP; the engine
 * already lives at mail/mail.routes.js, so the mailbox API does not 404.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const c = require("./signature.controller");
const v = require("./signature.validator");

const router = express.Router();
router.use(authMiddleware);
router.use(requireFeature("mail.signatures"));

router.get("/signature", c.me);
router.put("/signature", v.profile, c.saveMe);
router.get("/signature/preview", c.preview);
router.post("/signature/png", v.png, c.png);
router.get("/signature/png", c.png);

router.get("/signature/templates", requirePermission("MOD-70", "view"), c.templates);
router.patch("/signature/templates/:id", requirePermission("MOD-70", "edit"), v.templatePatch, c.updateTemplate);

module.exports = { basePath: "/mail", feature: null, router };
