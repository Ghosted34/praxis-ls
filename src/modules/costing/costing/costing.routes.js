/** Project costing (MOD-46). Gated + feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const {
  requireTransitionPermission, requireTransitionCapability,
} = require("../../../shared/http/transition-permission");
const controller = require("./costing.controller");
const validator = require("./costing.validator");
const MODULE = "MOD-46";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Both sides of the merge are kept, applied per target state.
//
//   permission  SUBMIT_* are the author sending their costing on, so they take
//               `edit`; APPROVE/REJECT are decisions and take `approve`.
//               Requiring `approve` to submit made the flow unusable once
//               maker-checker landed (the submitter could then never approve).
//   capability  Authorising a costing is an APPROVER act — the SoD overlay on
//               top of the module grant. Applied ONLY to the decision states:
//               demanding APPROVER to submit would be the same bug as demanding
//               `approve` to submit. CEO bypasses both.
const TRANSITION_ACTION = { SUBMIT_VALIDATION: "edit", SUBMIT_APPROVAL: "edit", APPROVE: "approve", REJECT: "approve" };
const TRANSITION_CAPABILITY = { APPROVE: "APPROVER", REJECT: "APPROVER" };

router.post(
  "/:id/status",
  validator.setStatus,
  requireTransitionPermission(MODULE, TRANSITION_ACTION),
  requireTransitionCapability(TRANSITION_CAPABILITY),
  controller.setStatus,
);
module.exports = { basePath: "/costings", feature: "costing", router };
