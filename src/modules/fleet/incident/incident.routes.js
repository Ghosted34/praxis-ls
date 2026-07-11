/**
 * Fleet incident routes — RBAC-gated (MOD-45) + feature "fleet".
 * Lifecycle: OPEN → UNDER_REVIEW → CLOSED via POST /:id/status.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./incident.controller");
const validator = require("./incident.validator");

const M = "MOD-45";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(M, "edit"), validator.status, controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/incidents", feature: "fleet", router };
