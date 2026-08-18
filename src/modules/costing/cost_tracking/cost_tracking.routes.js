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
// Portfolio first: Express matches in order, and while these do not collide
// with "/dossier/:dossierId" today, keeping the literal paths above the
// parameterised one is the habit that stops the next literal route from being
// swallowed silently.
router.get("/portfolio", requirePermission(MODULE, "view"), controller.portfolio);
router.get("/kpis", requirePermission(MODULE, "view"), controller.kpis);
router.get("/dossier/:dossierId", requirePermission(MODULE, "view"), controller.list);
router.get("/dossier/:dossierId/reconcile", requirePermission(MODULE, "view"), controller.reconcile);
module.exports = { basePath: "/cost-tracking", feature: "costing", router };
