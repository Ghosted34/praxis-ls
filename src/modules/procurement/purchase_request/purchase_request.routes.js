/** Purchase request (MOD-62). Gated; feature procurement.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./purchase_request.controller");
const validator = require("./purchase_request.validator");

const MODULE = "MOD-62";
const router = express.Router();
router.use(authMiddleware);

/**
 * Which permission each transition needs.
 *
 * The whole route used to require `approve`, so the person who raised a request
 * could not SUBMIT it — but submitting is the requester advancing their own
 * draft, not a decision. That was already wrong; maker-checker made it
 * self-defeating: only an approver could submit, and maker-checker then forbids
 * that same person from approving what they submitted, so no request could ever
 * get through.
 *
 *   SUBMITTED  → edit     the requester sends their draft on
 *   ORDERED    → edit     procurement converts it to a PO
 *   APPROVED   → approve  a real decision
 *   REJECTED   → approve  also a decision
 */
const TRANSITION_ACTION = {
  SUBMITTED: "edit",
  ORDERED: "edit",
  APPROVED: "approve",
  REJECTED: "approve",
};

/** requirePermission binds its action at mount time; this one depends on the body. */
function requireTransitionPermission(req, res, next) {
  const action = TRANSITION_ACTION[req.body && req.body.to] || "approve";
  return requirePermission(MODULE, action)(req, res, next);
}

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
// Validator runs FIRST so `to` is checked against the enum before it selects a
// permission — otherwise an unrecognised value would choose its own gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission, controller.transition);

module.exports = { basePath: "/purchase-requests", feature: null, router };
