"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./marketing_campaign.controller");
const validator = require("./marketing_campaign.validator");
const repo = require("./marketing_campaign.repo");
const { asyncHandler } = require("../../../utils/errors");
const MODULE = "MOD-22";

/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 *
 * ACTIVE is `edit` here and that is not a loophole: the ONLY route to ACTIVE
 * through this map is resuming a PAUSED campaign, which is the owner's act.
 * Approving a PENDING_APPROVAL one also lands on ACTIVE, but it does not come
 * through this endpoint at all — `rules.assertTransition` refuses every exit
 * from PENDING_APPROVAL, and POST /:id/approve carries its own `approve` gate.
 * Two acts with the same target state, two endpoints, two permissions.
 */
const TRANSITION_ACTION = {
  PENDING_APPROVAL: "edit",
  ACTIVE: "edit",
  PAUSED: "edit",
  ENDED: "approve",
};

/**
 * The permission a PATCH needs depends on the row's CURRENT state, not on
 * anything in the body — which is why `requireLifecyclePermissionOnPatch`
 * cannot express it. Two states are supervised:
 *
 *   PENDING_APPROVAL — F8's "guard stopping a sales-role user editing a
 *     campaign while it is pending approval". The legacy implements this by
 *     setting `readOnly` on inputs in the drawer, so it holds only for people
 *     using the drawer. Here the campaign owner (edit, no approve) is refused
 *     at the route, while the approver may still trim a budget before
 *     approving it rather than bouncing the whole plan back.
 *
 *   ENDED — amending a finished campaign's recorded figures. The trailing
 *     ad-manager report is a real need, so the record is not frozen; changing
 *     numbers on a closed campaign is a supervised act, so it is not free
 *     either.
 *
 * Every other state needs plain `edit`. A campaign that does not exist falls
 * through to the controller, which 404s — deciding the permission from a row
 * that is not there would leak whether it exists.
 */
function requireStateAwareEdit() {
  const BY_STATE = { PENDING_APPROVAL: "approve", ENDED: "approve" };
  return asyncHandler(async (req, res, next) => {
    const row = await req.tenantDb((c) => repo.get(c, req.params.id));
    const action = row ? BY_STATE[row.status] || "edit" : "edit";
    return requirePermission(MODULE, action)(req, res, next);
  });
}

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
// Literal segments before "/:id", same reason.
router.get("/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
router.get("/tiles", requirePermission(MODULE, "view"), controller.tiles);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
// Validator first, so the body is a known shape before the state decides the gate.
router.patch("/:id", validator.update, requireStateAwareEdit(), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
// The approval decision. Separate endpoints rather than transition targets,
// because approving and resuming share a target state and must not share a gate.
router.post("/:id/approve", requirePermission(MODULE, "approve"), controller.approve);
router.post("/:id/reject", requirePermission(MODULE, "approve"), validator.reject, controller.reject);
router.post("/:id/send", requirePermission(MODULE, "edit"), validator.send, controller.send);
module.exports = { basePath: "/campaigns", feature: null, router };
