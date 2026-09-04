/** Cash request / disbursal (MOD-49). Gated; feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission, requireCapability } = require("../../../middleware/rbac");
const {
  requireTransitionPermission, requireTransitionCapability,
} = require("../../../shared/http/transition-permission");
const controller = require("./cash_request.controller");
const validator = require("./cash_request.validator");

const MODULE = "MOD-49";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
// Literal segment before "/:id", or "kpis" parses as a cash-request id.
router.get("/kpis", requirePermission(MODULE, "view"), controller.kpis);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Importing budget lines from the linked APPROVED_LOCKED costing — a DRAFT
// edit by the requester, not a decision, so `edit` like the PATCH itself.
router.post("/:id/import-costing", requirePermission(MODULE, "edit"), validator.importCosting, controller.importCosting);
// Both sides of the merge are kept.
//
//   permission  Submitting is the requester's own act (`edit`); approving,
//               rejecting and disbursing are decisions (`approve`). Requiring
//               `approve` to submit made the flow unusable under maker-checker.
//   capability  APPROVER is demanded for the acts that release money, and only
//               for those — asking a requester to hold APPROVER in order to
//               submit would be the same bug one layer up.
// VALIDATED (finance, 10721) sits between SUBMITTED and APPROVED — both are
// decisions, so both carry the approve grant + APPROVER capability, exactly
// like the disbursement that follows them.
//
// 12771 — `validate` and `disburse` are now their own grants (permission
// gained can_validate / can_disburse), because the real policy is "Marie may
// hand over cash up to 500 000" and a role that can approve is not necessarily
// a role that holds the till. DRAFT is the reopen of a rejected request: the
// author's own act, so `edit`.
const TRANSITION_ACTION = { DRAFT: "edit", SUBMITTED: "edit", JUSTIFIED: "edit", VALIDATED: "validate", APPROVED: "approve", REJECTED: "approve", DISBURSED: "disburse" };
// APPROVER stays on the decisions that authorise money, and on disbursement
// (see the route below). It is NOT demanded for validation: the owner's
// decision is explicit that validating is a VISA, not a signature — the three
// signatories on the voucher are the requester, the approving authority and the
// disbursing authority (Q20). Validation is gated by `can_validate` alone.
const TRANSITION_CAPABILITY = { APPROVED: "APPROVER", REJECTED: "APPROVER" };

router.post(
  "/:id/transition",
  validator.transition,
  requireTransitionPermission(MODULE, TRANSITION_ACTION),
  requireTransitionCapability(TRANSITION_CAPABILITY),
  controller.transition,
);
/*
 * Handing over cash: its own grant (12771) ON TOP OF the authority overlay.
 *
 * ── WHY THE CAPABILITY STAYS, EVEN THOUGH `can_disburse` NOW EXISTS ────────
 *
 * This route was `approve` + APPROVER. `can_disburse` is backfilled from
 * `can_approve` so nobody is locked out on deploy — which means dropping the
 * capability here would WIDEN it: a tenant that had used the SoD overlay to
 * take disbursement away from some of its approvers would silently hand it
 * back. Quietly widening who can release cash is a worse outcome than an
 * administrator having to grant one capability, so both gates stand.
 *
 * `can_disburse` can therefore only NARROW disbursement below approval today,
 * which is the direction that matters: turn it off for the approving role and
 * the manager who authorises a spend is no longer the cashier who releases it.
 *
 * A dedicated cashier is still expressible WITHOUT approval rights: grant them
 * APPROVER (an overlay, not a grant — it authorises nothing on its own) plus
 * MOD-49 `can_disburse`, and leave `can_approve` off. They can pay out and they
 * cannot approve.
 */
router.post("/:id/disburse", requirePermission(MODULE, "disburse"), requireCapability("APPROVER"), validator.disburse, controller.disburse);
// Settling a part-paid request writes off money the treasury will not pay and
// hands budget back to the file — a decision, so `approve` + APPROVER.
router.post("/:id/close-balance", requirePermission(MODULE, "approve"), requireCapability("APPROVER"), validator.closeBalance, controller.closeBalance);
// The holder acknowledging that they took an instalment. Their own act, so
// `edit` — gating a receipt behind an approval grant is how receipts stop being
// collected.
router.post("/:id/payments/:paymentId/receipt", requirePermission(MODULE, "edit"), validator.acknowledge, controller.acknowledge);
router.post("/:id/justify", requirePermission(MODULE, "edit"), validator.justify, controller.justify);

module.exports = { basePath: "/cash-requests", feature: "costing", router };
