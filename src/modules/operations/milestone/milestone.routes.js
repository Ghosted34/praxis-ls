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
router.post("/:id/advance", requirePermission(MODULE, "edit"), validator.advance, controller.advance);
module.exports = { basePath: "/milestones", feature: "operations", router };
