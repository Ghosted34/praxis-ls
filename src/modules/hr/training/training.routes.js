/** Training routes — RBAC-gated (MOD-18) + feature "hr.training".
 *
 * Session lifecycle SCHEDULED → LIVE → DONE | CANCELLED via POST /:id/status.
 * Roster: GET/POST /:id/attendees, PATCH /:id/attendees/:attendeeId.
 * Live session: POST /:id/join, /:id/leave, /:id/notes, /:id/summarise.
 * Requirements: /requirements (+ /:requirementId/compliance).
 *
 * ROUTE ORDER MATTERS HERE. `/requirements` and `/certificates` are declared
 * BEFORE `/:id`, or Express matches them as a training id and every request
 * returns "Training not found" for a training nobody asked for.
 */
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
 *
 * LIVE is `edit`: opening a session is advancing it, and requiring an approval
 * grant to press Start would mean the facilitator cannot start their own class.
 */
const TRANSITION_ACTION = {
  SCHEDULED: "edit",
  LIVE: "edit",
  DONE: "approve",
  CANCELLED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

/* ── Requirements & compliance (before /:id — see header) ───────────────── */
router.get("/requirements", requirePermission(M, "view"), controller.listRequirements);
router.post("/requirements", requirePermission(M, "create"), validator.requirement, controller.createRequirement);
router.patch("/requirements/:requirementId", requirePermission(M, "edit"), validator.requirementUpdate, controller.updateRequirement);
router.get("/requirements/:requirementId/compliance", requirePermission(M, "view"), controller.compliance);
router.get("/certificates/expiring", requirePermission(M, "view"), controller.expiringCertificates);

/* ── Sessions ───────────────────────────────────────────────────────────── */
router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/attendees", requirePermission(M, "view"), controller.listAttendees);
router.post("/:id/attendees", requirePermission(M, "edit"), validator.attendee, controller.addAttendee);
router.patch("/:id/attendees/:attendeeId", requirePermission(M, "edit"), validator.attendeeUpdate, controller.updateAttendee);

/* ── Live session ───────────────────────────────────────────────────────── */
// Joining is `edit` and not `create`: the roster row is bookkeeping for an act
// that already happened. Refusing it would put somebody in the room and not on
// the register, which is the opposite of what the permission protects.
router.post("/:id/join", requirePermission(M, "edit"), validator.presence, controller.join);
router.post("/:id/leave", requirePermission(M, "edit"), validator.presence, controller.leave);
router.post("/:id/notes", requirePermission(M, "edit"), validator.note, controller.addNote);
// Live dictation (10708): transcribe one ~30s chunk of the session recording
// and append its words to the running transcript. `edit`, like the notes it
// feeds — it is capture, not a decision.
router.post("/:id/dictate", requirePermission(M, "edit"), validator.dictate, controller.dictate);
router.post("/:id/summarise", requirePermission(M, "edit"), controller.summarise);

// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint below when — and only when — the body carries it.
router.patch("/:id", requirePermission(M, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(M, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/trainings", feature: "hr.training", router };
