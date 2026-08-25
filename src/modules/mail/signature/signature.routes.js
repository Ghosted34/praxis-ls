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

// Route-scoped feature gates — never router-level. See the header in
// deliverability.routes.js for why a router.use here must never come back.
router.get("/signature", requireFeature("mail.signatures"), c.me);
router.put("/signature", requireFeature("mail.signatures"), v.profile, c.saveMe);
router.get("/signature/preview", requireFeature("mail.signatures"), c.preview);
router.post("/signature/png", requireFeature("mail.signatures"), v.png, c.png);
router.get("/signature/png", requireFeature("mail.signatures"), c.png);

router.get("/signature/templates", requireFeature("mail.signatures"), requirePermission("MOD-70", "view"), c.templates);
router.patch("/signature/templates/:id", requireFeature("mail.signatures"), requirePermission("MOD-70", "edit"), v.templatePatch, c.updateTemplate);

module.exports = { basePath: "/mail", feature: null, router };
