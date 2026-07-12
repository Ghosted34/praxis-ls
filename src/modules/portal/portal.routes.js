/**
 * Portals. Access management (grant/revoke/list) is IAM-gated (MOD-67). Each
 * data view is additionally feature-gated: portal.client (MOD-29), portal.investor
 * (MOD-56), portal.audit (MOD-69). External-user auth is a separate surface; these
 * routes let staff manage grants and preview each portal's exact scope.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const { requireFeature } = require("../../middleware/feature-gate");
const controller = require("./portal.controller");
const validator = require("./portal.validator");

const router = express.Router();
router.use(authMiddleware);

// Access management (IAM)
router.get("/access", requirePermission("MOD-67", "view"), controller.listAccess);
router.post("/access", requirePermission("MOD-67", "edit"), validator.grant, controller.grant);
router.post("/access/:id/revoke", requirePermission("MOD-67", "edit"), controller.revoke);
router.get("/access/check", requirePermission("MOD-67", "view"), controller.check);

// Scoped data views
router.get("/client", requireFeature("portal.client"), requirePermission("MOD-29", "view"), controller.client);
router.get("/investor", requireFeature("portal.investor"), requirePermission("MOD-56", "view"), controller.investor);
router.get("/auditor", requireFeature("portal.audit"), requirePermission("MOD-69", "view"), controller.auditor);

module.exports = { basePath: "/portals", feature: null, router };
