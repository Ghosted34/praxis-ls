/** Milestone tracking (MOD-31). Gated + feature operations. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./milestone.controller");
const validator = require("./milestone.validator");
const MODULE = "MOD-31";
const router = express.Router();
router.use(authMiddleware);
router.get("/templates", requirePermission(MODULE, "view"), controller.listTemplates);
router.post("/templates", requirePermission(MODULE, "create"), validator.publishTemplate, controller.publishTemplate);
router.post("/instantiate", requirePermission(MODULE, "create"), validator.instantiate, controller.instantiate);
router.get("/dossier/:dossierId", requirePermission(MODULE, "view"), controller.byDossier);
// Insert a stage into a LIVE chain (between two existing ones) and re-forecast
// what follows — the "a problem arises before the next milestone" case.
router.post("/dossier/:dossierId/stages", requirePermission(MODULE, "edit"), validator.addStage, controller.addStage);
// Force a re-baseline: used after a promised date changes, and by the SLA scan.
router.post("/dossier/:dossierId/recalculate", requirePermission(MODULE, "edit"), validator.recalculate, controller.recalculate);
router.get("/assumptions/:serviceTypeId", requirePermission(MODULE, "view"), controller.assumptions);
router.post("/:id/advance", requirePermission(MODULE, "edit"), validator.advance, controller.advance);
// Un-completing is not an ordinary transition (frozen DONE is what makes
// variance measurable), so it has its own route, permission and reason.
router.post("/:id/reopen", requirePermission(MODULE, "edit"), validator.reopen, controller.reopen);
module.exports = { basePath: "/milestones", feature: "operations", router };
