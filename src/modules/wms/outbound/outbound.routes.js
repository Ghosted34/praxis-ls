/**
 * Outbound routes — RBAC-gated (MOD-36) + feature "wms.inventory".
 * Order lifecycle: CREATED → PICKING → PACKED → DISPATCHED | CANCELLED via
 * POST /:id/status (DISPATCHED stamps dispatched_at). Lines: GET/POST /:id/lines,
 * PATCH /:id/lines/:lineId to flag picked/packed.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./outbound.controller");
const validator = require("./outbound.validator");

const M = "MOD-36";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/lines", requirePermission(M, "view"), controller.listLines);
router.post("/:id/lines", requirePermission(M, "edit"), validator.line, controller.addLine);
router.patch("/:id/lines/:lineId", requirePermission(M, "edit"), validator.lineFlags, controller.setLineFlags);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(M, "edit"), validator.status, controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/outbound", feature: "wms.inventory", router };
