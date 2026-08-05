"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./marketing_campaign.controller");
const validator = require("./marketing_campaign.validator");
const MODULE = "MOD-22";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  ACTIVE: "edit",
  PAUSED: "edit",
  ENDED: "approve",
};

const router = express.Router();
router.use(authMiddleware);
router.get("/subscribers", requirePermission(MODULE, "view"), controller.subscribers);
router.post("/subscribers", requirePermission(MODULE, "create"), validator.subscribe, controller.subscribe);
router.post("/subscribers/unsubscribe", requirePermission(MODULE, "edit"), validator.unsubscribe, controller.unsubscribe);
// Sending identities + email templates — registered BEFORE "/:id" so the literal
// path segments aren't captured by the campaign-id route.
router.get("/senders", requirePermission(MODULE, "view"), controller.listSenders);
router.post("/senders", requirePermission(MODULE, "create"), validator.senderCreate, controller.createSender);
router.post("/senders/:id/verify", requirePermission(MODULE, "edit"), controller.verifySender);
router.delete("/senders/:id", requirePermission(MODULE, "delete"), controller.deleteSender);
router.get("/templates", requirePermission(MODULE, "view"), controller.listTemplates);
router.post("/templates", requirePermission(MODULE, "create"), validator.templateCreate, controller.createTemplate);
router.get("/templates/:id", requirePermission(MODULE, "view"), controller.getTemplate);
router.patch("/templates/:id", requirePermission(MODULE, "edit"), validator.templateUpdate, controller.updateTemplate);
router.delete("/templates/:id", requirePermission(MODULE, "delete"), controller.deleteTemplate);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/send", requirePermission(MODULE, "edit"), validator.send, controller.send);
module.exports = { basePath: "/campaigns", feature: null, router };
