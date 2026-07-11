/** Project costing (MOD-46). Gated + feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./costing.controller");
const validator = require("./costing.validator");
const MODULE = "MOD-46";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(MODULE, "approve"), validator.setStatus, controller.setStatus);
module.exports = { basePath: "/costings", feature: "costing", router };
