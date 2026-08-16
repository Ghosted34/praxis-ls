/**
 * Partnership requests and vendor onboarding (MOD-25, F10).
 *
 * WHY THIS IS ITS OWN MODULE. It used to be half of `sales/inbound_intake`,
 * sharing a service and a route file with contact enquiries. They are two
 * different desks: an enquiry is answered or becomes a lead, an application is
 * VETTED and can end with a new party in the supplier register. Splitting them
 * is what lets this one own its lifecycle, its KPI partitions and its approval
 * side effect without either growing conditionals about the other.
 *
 * BREAKING (same commit): POST/GET /api/tenant/intake/partnerships* are now
 * /api/tenant/partnership-requests*. Nothing in client/ called the old paths —
 * the register they belonged to was never built — so the move costs no caller.
 * `intake/enquiries` stays where it is for F9.
 *
 * PER-ACTION RBAC. Working the desk is `edit`; the DECISION is `approve`.
 * Approving is the moment a stranger becomes a party this company can be
 * invoiced by, and rejecting ends someone's application — neither belongs on
 * the same grant as adding a note. Re-opening a rejected application is
 * `approve` too: it reverses a decision.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./partnership_request.controller");
const validator = require("./partnership_request.validator");

const MODULE = "MOD-25";

/** Anything unmapped falls back to `approve`, so a state added later fails closed. */
const TRANSITION_ACTION = {
  IN_REVIEW: "edit",
  REJECTED: "approve",
  APPROVED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
router.get("/tiles", requirePermission(MODULE, "view"), controller.tiles);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);

router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }), controller.update);

// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/approve", requirePermission(MODULE, "approve"), validator.approve, controller.approve);
router.post("/:id/reject", requirePermission(MODULE, "approve"), validator.reject, controller.reject);

// The corporate profile document, into the vault.
router.post("/:id/profile", requirePermission(MODULE, "edit"), validator.profile, controller.uploadProfile);

module.exports = { basePath: "/partnership-requests", feature: null, router };
