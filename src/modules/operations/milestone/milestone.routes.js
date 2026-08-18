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
/* Re-activate a superseded version (10708b). `approve`, not `edit`: it
 * decides what every FUTURE dossier of that service type opens with — the
 * same authority as publishing. Declared before `/:id/...` so the path is not
 * read as a milestone-instance id. */
router.post("/templates/:templateId/activate", requirePermission(MODULE, "approve"), controller.activateTemplate);
router.post("/instantiate", requirePermission(MODULE, "create"), validator.instantiate, controller.instantiate);
router.get("/dossier/:dossierId", requirePermission(MODULE, "view"), controller.byDossier);
// Insert a stage into a LIVE chain (between two existing ones) and re-forecast
// what follows — the "a problem arises before the next milestone" case.
router.post("/dossier/:dossierId/stages", requirePermission(MODULE, "edit"), validator.addStage, controller.addStage);
// Force a re-baseline: used after a promised date changes, and by the SLA scan.
router.post("/dossier/:dossierId/recalculate", requirePermission(MODULE, "edit"), validator.recalculate, controller.recalculate);
// The shipped default chain, for the editor's drift indicator and its
// "restore the default" action.
// "Who is costing us time" — attribution rolled up by owner tier.
router.get("/attribution", requirePermission(MODULE, "view"), controller.attribution);
router.get("/system-default/:serviceTypeId", requirePermission(MODULE, "view"), controller.systemDefault);
router.get("/assumptions/:serviceTypeId", requirePermission(MODULE, "view"), controller.assumptions);
// The published register is part of what a client was promised, so writing it
// needs the same permission as changing the chain itself.
router.put("/assumptions/:serviceTypeId", requirePermission(MODULE, "edit"), validator.saveAssumptions, controller.saveAssumptions);
router.post("/:id/advance", requirePermission(MODULE, "edit"), validator.advance, controller.advance);
router.patch("/:id/public-details", requirePermission(MODULE, "edit"), validator.publicDetails, controller.updatePublicDetails);
// Un-completing is not an ordinary transition (frozen DONE is what makes
// variance measurable), so it has its own route, permission and reason.
router.post("/:id/reopen", requirePermission(MODULE, "edit"), validator.reopen, controller.reopen);
module.exports = { basePath: "/milestones", feature: "operations", router };
