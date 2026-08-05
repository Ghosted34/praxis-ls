/** Vacancy routes — RBAC-gated (MOD-11) + feature "hr.recruitment".
 * Vacancy lifecycle DRAFT → OPEN → CLOSED via POST /:id/status.
 * Applicants: GET/POST /:id/applicants, PATCH /:id/applicants/:applicantId. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./vacancy.controller");
const validator = require("./vacancy.validator");

const M = "MOD-11";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  DRAFT: "edit",
  OPEN: "edit",
  CLOSED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/applicants", requirePermission(M, "view"), controller.listApplicants);
router.post("/:id/applicants", requirePermission(M, "edit"), validator.applicant, controller.addApplicant);
router.patch("/:id/applicants/:applicantId", requirePermission(M, "edit"), validator.applicantStatus, controller.setApplicantStatus);
// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint above when — and only when — the body carries it.
router.patch("/:id", requirePermission(M, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(M, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/vacancies", feature: "hr.recruitment", router };
