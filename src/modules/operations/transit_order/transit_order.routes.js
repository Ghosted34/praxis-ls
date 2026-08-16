/** Transit order (MOD-30). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./transit_order.controller");
const validator = require("./transit_order.validator");

const MODULE = "MOD-30";

/**
 * Which permission each target state needs.
 *
 * ISSUING is a `create`-class act — the clerk preparing the order sends it out,
 * and it is the moment the number is burned. SIGNING and LODGING are `edit`:
 * they record something that happened outside the system. CANCELLING an order
 * that customs may already have seen is `approve`, the strict end.
 *
 * Anything not listed falls back to `approve` (see transition-permission.js), so
 * a state added later without updating this map fails closed.
 */
const TRANSITION_ACTION = {
  ISSUED: "create",
  SIGNED: "edit",
  LODGED: "edit",
  CANCELLED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/summary", requirePermission(MODULE, "view"), controller.summary);
// Static before `/:id`, or "document-types" is parsed as an id.
router.get("/document-types", requirePermission(MODULE, "view"), controller.docTypes);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);

router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.patch("/:id/documents", requirePermission(MODULE, "edit"), validator.updateDocs, controller.updateDocs);

// Named transitions — the shape each one actually needs, validated by name.
router.post("/:id/issue", requirePermission(MODULE, "create"), validator.issue, controller.issue);
router.post("/:id/sign", requirePermission(MODULE, "edit"), validator.sign, controller.sign);
router.post("/:id/lodge", requirePermission(MODULE, "edit"), validator.lodge, controller.lodge);
router.post("/:id/cancel", requirePermission(MODULE, "approve"), validator.cancel, controller.cancel);

// The generic envelope, for callers that drive lifecycles uniformly. Mounted
// AFTER the validator so the target state is known before it picks its gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);

module.exports = { basePath: "/transit-orders", feature: null, router };
