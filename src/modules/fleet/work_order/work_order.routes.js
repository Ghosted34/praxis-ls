/**
 * Maintenance work-order routes — RBAC-gated (MOD-41) + feature "fleet.maintenance".
 * Lifecycle: OPEN → IN_PROGRESS → DONE | CANCELLED via POST /:id/status.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./work_order.controller");
const validator = require("./work_order.validator");

const M = "MOD-41";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  OPEN: "edit",
  IN_PROGRESS: "edit",
  DONE: "approve",
  CANCELLED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint above when — and only when — the body carries it.
router.patch("/:id", requirePermission(M, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(M, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);
router.get("/:id/parts", requirePermission(M, "view"), controller.listParts);
router.post("/:id/parts", requirePermission(M, "edit"), validator.part, controller.addPart);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/work-orders", feature: "fleet.maintenance", router };
