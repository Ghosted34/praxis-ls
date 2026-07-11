/** Cost tracking + reconciliation (MOD-47). Gated + feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./cost_tracking.controller");
const validator = require("./cost_tracking.validator");
const MODULE = "MOD-47";
const router = express.Router();
router.use(authMiddleware);
router.post("/", requirePermission(MODULE, "create"), validator.record, controller.record);
router.get("/dossier/:dossierId", requirePermission(MODULE, "view"), controller.list);
router.get("/dossier/:dossierId/reconcile", requirePermission(MODULE, "view"), controller.reconcile);
module.exports = { basePath: "/cost-tracking", feature: "costing", router };
