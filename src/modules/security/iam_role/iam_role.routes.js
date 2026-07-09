/**
 * Was bare makeRouter() with no auth/RBAC gating — a pre-existing gap noted
 * in doc/RBAC_SECURITY_KICKOFF.md and doc/WORK_TO_BE_DONE.md. Gated here
 * following capability.routes.js's pattern; role sits under the same
 * MOD-67 (IAM/RBAC engine) grant as capability/scope/permission/
 * field_visibility — one module_key covers the whole IAM screen group.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./iam_role.controller");
const validator = require("./iam_role.validator");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/roles", feature: null, router };
