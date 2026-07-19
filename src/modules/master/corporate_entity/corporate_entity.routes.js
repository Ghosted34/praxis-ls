/** Corporate entities (MOD-01). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./corporate_entity.controller");
const validator = require("./corporate_entity.validator");

const MODULE = "MOD-01";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/active", requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
// Per-entity letterhead logo (light/dark). MOD-01 edit — deliberately not the
// MOD-70-gated /branding/logo, so entity admins don't need settings-admin rights.
router.post("/:id/logo", requirePermission(MODULE, "edit"), validator.logoUpload, controller.uploadLogo);

module.exports = { basePath: "/entities", feature: null, router };
