/**
 * AI Governance / AI Control (AI_ARCHITECTURE §6). Admin surface for the AI
 * subsystem: feature toggles, access grants, spend caps, vendor keys. Gated by
 * auth + the ai.assistant.backend feature; writes need MOD-70 (Settings) edit.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./governance.controller");
const validator = require("./governance.validator");

const MODULE = "MOD-70";
const router = express.Router();
router.use(authMiddleware);

router.get("/features", requirePermission(MODULE, "view"), controller.listFeatures);
router.patch("/features/:key", requirePermission(MODULE, "edit"), validator.setFeature, controller.setFeature);

router.get("/grants", requirePermission(MODULE, "view"), controller.listGrants);
router.post("/grants", requirePermission(MODULE, "edit"), validator.grant, controller.grant);
router.post("/grants/revoke", requirePermission(MODULE, "edit"), validator.revoke, controller.revoke);

router.get("/budget", requirePermission(MODULE, "view"), controller.budget);
router.post("/budget", requirePermission(MODULE, "edit"), validator.setBudget, controller.setBudget);
router.get("/can-use", requirePermission(MODULE, "view"), controller.canUse);
router.get("/usage", requirePermission(MODULE, "view"), controller.usage);

router.get("/vendors", requirePermission(MODULE, "view"), controller.listVendors);
router.put("/vendors/:vendor", requirePermission(MODULE, "edit"), validator.setVendor, controller.setVendor);
router.post("/vendors/:vendor/test", requirePermission(MODULE, "edit"), controller.testVendor);

module.exports = { basePath: "/ai/governance", feature: "ai.assistant.backend", router };
