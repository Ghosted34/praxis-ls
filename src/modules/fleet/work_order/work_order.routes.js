/**
 * Maintenance work-order routes — RBAC-gated (MOD-41) + feature "fleet.maintenance".
 * Lifecycle: OPEN → IN_PROGRESS → DONE | CANCELLED via POST /:id/status.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./work_order.controller");
const validator = require("./work_order.validator");

const M = "MOD-41";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(M, "edit"), validator.status, controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/work-orders", feature: "fleet.maintenance", router };
