/** Operations file / dossier (MOD-29). Gated + feature operations. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./operations_file.controller");
const validator = require("./operations_file.validator");
const MODULE = "MOD-29";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/transition", requirePermission(MODULE, "edit"), validator.transition, controller.transition);
module.exports = { basePath: "/operations", feature: "operations", router };
