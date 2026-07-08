/**
 * The entity/branch/department tree a user belongs to (DB_ARCHITECTURE §4.2).
 * `parent_scope_id` gives the organigramme; `user_scope` assigns users.
 * See capability.routes.js for why this wires auth/RBAC explicitly instead
 * of using the bare makeRouter() other security modules currently use.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./scope.controller");
const validator = require("./scope.validator");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/scopes", feature: null, router };
