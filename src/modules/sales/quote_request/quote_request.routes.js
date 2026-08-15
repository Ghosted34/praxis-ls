"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./quote_request.controller");
const validator = require("./quote_request.validator");
const MODULE = "MOD-20";

/**
 * Quote request routes (MOD-20-intake) — the logistics-scope intake register
 * (F6, doc/SALES_CRM_FEATURES.md).
 *
 * Per-state RBAC: advancing through the intake funnel is `edit`; the
 * decision that ENDS the record (CONVERTED / CLOSED) is `approve`. Anything
 * unmapped falls back to `approve` so a state added later fails closed —
 * the same pattern lead.routes.js uses.
 */
const TRANSITION_ACTION = {
  UNDER_REVIEW: "edit",
  CLARIFICATION_REQUIRED: "edit",
  QUOTED: "edit",
  CONVERTED_TO_OPPORTUNITY: "approve",
  CLOSED_NO_ACTION: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }), controller.update);
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/convert-to-opportunity", requirePermission(MODULE, "approve"), validator.convertToOpportunity, controller.convertToOpportunity);

// Attachments
router.get("/:id/attachments", requirePermission(MODULE, "view"), controller.listAttachments);
router.post("/:id/attachments", requirePermission(MODULE, "edit"), controller.addAttachment);
router.delete("/:id/attachments/:attachmentId", requirePermission(MODULE, "edit"), controller.removeAttachment);

module.exports = { basePath: "/quote-requests", feature: null, router };
