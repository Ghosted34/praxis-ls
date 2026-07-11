/** Training routes — RBAC-gated (MOD-18) + feature "hr.training".
 * Session lifecycle SCHEDULED → DONE | CANCELLED via POST /:id/status.
 * Attendance roster: GET/POST /:id/attendees, PATCH /:id/attendees/:attendeeId. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./training.controller");
const validator = require("./training.validator");

const M = "MOD-18";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/attendees", requirePermission(M, "view"), controller.listAttendees);
router.post("/:id/attendees", requirePermission(M, "edit"), validator.attendee, controller.addAttendee);
router.patch("/:id/attendees/:attendeeId", requirePermission(M, "edit"), validator.attendeeUpdate, controller.updateAttendee);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(M, "edit"), validator.status, controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/trainings", feature: "hr.training", router };
