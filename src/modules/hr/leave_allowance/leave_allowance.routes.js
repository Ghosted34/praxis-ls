/** Leave / allowance routes — RBAC-gated (MOD-15) + feature "hr".
 *  Decision: REQUESTED → APPROVED | REJECTED via POST /:id/decision;
 *  REQUESTED | APPROVED → CANCELLED via POST /:id/cancel (0696).
 *
 *  ── WHAT EACH GRANT BUYS, AND WHY ────────────────────────────────────────
 *
 *  BALANCES are `view`. Reading what a colleague has left is ordinary work for
 *  anyone who can see the leave queue at all, and hiding it would mean deciding
 *  a request without the one number the decision turns on.
 *
 *  YOUR OWN balance takes no grant (`/mine/balances`), for the same reason
 *  `/mine` doesn't: an employee is always entitled to their own figure.
 *
 *  ADJUSTING a balance is `approve`, not `edit`. It creates entitlement out of
 *  nothing — the same authority as approving the leave that spends it, and a
 *  strictly larger one than editing a request.
 *
 *  LEAVE TYPES and HOLIDAYS are `edit`: they change what every future request
 *  is measured against, which is a change to the process rather than to one
 *  record. Literal paths are declared BEFORE `/:id` or `/types` is read as a
 *  request id and refused by the uuid guard.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./leave_allowance.controller");
const validator = require("./leave_allowance.validator");

const M = "MOD-15";
const router = express.Router();
router.use(authMiddleware);

// Self-service — the caller's own leave/allowance requests (My HR). No MOD grant.
router.get("/mine", controller.mine);
router.get("/mine/balances", controller.myBalances);

/* ── Catalogues, before /:id ── */
router.get("/types", requirePermission(M, "view"), controller.listTypes);
router.post("/types", requirePermission(M, "edit"), validator.leaveType, controller.createType);
router.patch("/types/:id", requirePermission(M, "edit"), validator.leaveTypeUpdate, controller.updateType);

router.get("/holidays", requirePermission(M, "view"), controller.listHolidays);
router.post("/holidays", requirePermission(M, "edit"), validator.holiday, controller.addHoliday);
router.delete("/holidays/:id", requirePermission(M, "edit"), controller.removeHoliday);

/* ── Balances ── */
router.get("/balances/:employeeId", requirePermission(M, "view"), controller.balances);
router.get("/ledger/:employeeId", requirePermission(M, "view"), controller.ledger);
router.post("/adjustments", requirePermission(M, "approve"), validator.adjust, controller.adjust);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/decision", requirePermission(M, "approve"), validator.decision, controller.decide);
// `edit`, not `approve`: cancelling gives entitlement BACK. It cannot create
// leave nobody approved, and requiring the approver's grant to undo a booking
// is how stale approved requests accumulate.
router.post("/:id/cancel", requirePermission(M, "edit"), controller.cancel);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/leave", feature: null, router };
