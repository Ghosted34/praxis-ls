/**
 * Payroll routes (MOD-17). RBAC-gated. SoD: compute (edit) and approval
 * transitions (approve) are separate permissions so the same person can't both
 * run and validate payroll.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./payroll.controller");
const validator = require("./payroll.validator");

const M = "MOD-17";
const router = express.Router();
router.use(authMiddleware);

// Self-service — the caller's own payslips (My HR). No MOD grant.
router.get("/mine", controller.mine);
router.get("/mine/:runItemId/pdf", controller.ownPayslipPdf);
// …and what they still owe. An employee is always entitled to know what is
// being recovered from their pay and how much is left.
router.get("/advances/mine", controller.myAdvances);

/* ── Salary advances (0698) ────────────────────────────────────────────────
 *
 * CREATING or RESCHEDULING a plan is `approve`, not `edit`. It decides what
 * comes out of somebody's pay for the next several months, and writing one off
 * forgives real money — the same authority as validating the run that recovers
 * it, and a strictly larger one than computing a payslip.
 *
 * Declared before `/:id` so `/advances` is not read as a run id.
 */
router.get("/advances", requirePermission(M, "view"), controller.listAdvances);
router.post("/advances", requirePermission(M, "approve"), validator.advance, controller.createAdvance);
router.get("/advances/:advanceId", requirePermission(M, "view"), controller.getAdvance);
router.patch("/advances/:advanceId", requirePermission(M, "approve"), validator.advanceUpdate, controller.updateAdvance);

router.get("/", requirePermission(M, "view"), controller.list);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.post("/", requirePermission(M, "create"), validator.createRun, controller.create);
router.post("/:id/compute", requirePermission(M, "edit"), validator.compute, controller.compute);
// Computing and submitting a run is payroll's own work; approving, validating
// and disbursing are decisions. The SoD note above still holds — compute and
// approve remain different permissions. See shared/http/transition-permission.js.
const TRANSITION_ACTION = { COMPUTED: "edit", SUBMITTED: "edit", OPEN: "edit", APPROVED: "approve", VALIDATED: "approve", DISBURSED: "approve", REJECTED: "approve" };

router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);

module.exports = { basePath: "/payroll", feature: null, router };
