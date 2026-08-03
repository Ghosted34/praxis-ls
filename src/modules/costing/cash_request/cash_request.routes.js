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
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Both sides of the merge are kept.
//
//   permission  Submitting is the requester's own act (`edit`); approving,
//               rejecting and disbursing are decisions (`approve`). Requiring
//               `approve` to submit made the flow unusable under maker-checker.
//   capability  APPROVER is demanded for the acts that release money, and only
//               for those — asking a requester to hold APPROVER in order to
//               submit would be the same bug one layer up.
const TRANSITION_ACTION = { SUBMITTED: "edit", JUSTIFIED: "edit", APPROVED: "approve", REJECTED: "approve", DISBURSED: "approve" };
const TRANSITION_CAPABILITY = { APPROVED: "APPROVER", REJECTED: "APPROVER", DISBURSED: "APPROVER" };

router.post(
  "/:id/transition",
  validator.transition,
  requireTransitionPermission(MODULE, TRANSITION_ACTION),
  requireTransitionCapability(TRANSITION_CAPABILITY),
  controller.transition,
);
// Disbursing money is the canonical APPROVER act — segregation of duties on top
// of the module grant (requireCapability, MOD-67 authority overlay). CEO bypasses.
router.post("/:id/disburse", requirePermission(MODULE, "approve"), requireCapability("APPROVER"), validator.disburse, controller.disburse);
router.post("/:id/justify", requirePermission(MODULE, "edit"), validator.justify, controller.justify);

module.exports = { basePath: "/cash-requests", feature: "costing", router };
