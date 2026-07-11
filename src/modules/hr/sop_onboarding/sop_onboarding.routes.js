/** SOP document routes — RBAC-gated (MOD-16) + feature "hr". Standard operating
 * procedures with versioning; onboarding checklists build on top later. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./sop_onboarding.controller");
const validator = require("./sop_onboarding.validator");

const M = "MOD-16";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/sops", feature: null, router };
