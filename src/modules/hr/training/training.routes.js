/** Training routes — RBAC-gated (MOD-18) + feature "hr.training".
 * Session lifecycle SCHEDULED → DONE | CANCELLED via POST /:id/status.
 * Attendance roster: GET/POST /:id/attendees, PATCH /:id/attendees/:attendeeId. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./training.controller");
const validator = require("./training.validator");

const M = "MOD-18";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  SCHEDULED: "edit",
  DONE: "approve",
  CANCELLED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/attendees", requirePermission(M, "view"), controller.listAttendees);
router.post("/:id/attendees", requirePermission(M, "edit"), validator.attendee, controller.addAttendee);
router.patch("/:id/attendees/:attendeeId", requirePermission(M, "edit"), validator.attendeeUpdate, controller.updateAttendee);
// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint above when — and only when — the body carries it.
router.patch("/:id", requirePermission(M, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(M, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/trainings", feature: "hr.training", router };
