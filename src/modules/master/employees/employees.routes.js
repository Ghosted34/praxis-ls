/** Employee master (MOD-02). RBAC-gated; foundational master data (no feature flag). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./employees.controller");
const validator = require("./employees.validator");

const MODULE = "MOD-02";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/roster", requirePermission(MODULE, "view"), controller.roster);
router.get("/drivers", requirePermission(MODULE, "view"), controller.drivers);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/references", requirePermission(MODULE, "view"), controller.references);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/active", requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/employees", feature: null, router };
