"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const c = require("./deliverability.controller");
const v = require("./deliverability.validator");

const router = express.Router();
router.use(authMiddleware);

// Route-scoped feature gates — never router-level. A router.use here runs
// for EVERY /mail/* request that falls through to this router (same base
// path as every mail module), including paths it does not own: with
// mail.deliverability off the whole inbox, folders and mailbox setup
// answered 403 before they reached mail.routes.js. See
// tests/security/mail-gate-scope-deliverability-signature.test.js.
router.get("/deliverability", requireFeature("mail.deliverability"), requirePermission("MOD-70", "view"), c.list);
router.post("/deliverability/check", requireFeature("mail.deliverability"), requirePermission("MOD-70", "edit"), v.check, c.check);
router.get("/deliverability/:domain/history", requireFeature("mail.deliverability"), requirePermission("MOD-70", "view"), c.history);

module.exports = { basePath: "/mail", feature: null, router, idParam: "text" };
