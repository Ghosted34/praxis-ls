/**
 * Per-target-state permission for lifecycle transitions.
 *
 * Every `POST /:id/transition|status` route in the codebase was mounted as
 * `requirePermission(MODULE, "approve")` — one permission for every target
 * state. That conflates two different acts:
 *
 *   SUBMITTING   the requester advancing their own draft
 *   DECIDING     someone else approving or rejecting it
 *
 * Requiring `approve` to submit means only approvers can submit. That was
 * already wrong — a clerk should be able to send their own requisition on — and
 * maker-checker makes it self-defeating: the approver who submits is then
 * forbidden from approving what they submitted, so the document cannot move at
 * all. Found when a Sales user couldn't submit a purchase request
 * (doc/PERMISSION_SWEEP_BACKLOG.md §A).
 *
 * `requirePermission` binds its action at mount time; the action here depends on
 * the request body, so this resolves it per request and delegates.
 *
 * Mount it AFTER the validator, so the target state has been checked against the
 * module's enum before it is allowed to choose its own gate. Anything not in the
 * map falls back to `approve` — the strict end, so a state added later without
 * updating the map fails closed rather than open.
 */
"use strict";

const { requirePermission, requireCapability } = require("../../middleware/rbac");

function requireTransitionPermission(moduleKey, actionByTarget, opts = {}) {
  const field = opts.field || "to";
  const fallback = opts.fallback || "approve";
  return function transitionRbac(req, res, next) {
    const target = req.body ? req.body[field] : undefined;
    const action = actionByTarget[target] || fallback;
    return requirePermission(moduleKey, action)(req, res, next);
  };
}

/**
 * The segregation-of-duties overlay, applied per target state.
 *
 * `requireCapability('APPROVER')` is the right gate on a decision — it is the
 * authority layer that sits on top of the module grant. It is the WRONG gate on
 * a submission: requiring APPROVER to submit is the same bug as requiring
 * `approve` to submit, one layer up. So the capability is selected by target
 * state too, and states not in the map are unaffected.
 *
 *     router.post("/:id/status",
 *       validator.setStatus,
 *       requireTransitionPermission(MODULE, TRANSITION_ACTION),
 *       requireTransitionCapability({ APPROVE: "APPROVER", REJECT: "APPROVER" }),
 *       controller.setStatus);
 */
function requireTransitionCapability(capabilityByTarget, opts = {}) {
  const field = opts.field || "to";
  return function transitionCapability(req, res, next) {
    const target = req.body ? req.body[field] : undefined;
    const code = capabilityByTarget[target];
    if (!code) return next();
    return requireCapability(code)(req, res, next);
  };
}

/**
 * Close the PATCH back-door onto a lifecycle field (API F-17 / F-21).
 *
 * The near-universal module idiom is `{ create, update: create.partial() }`, so
 * every field accepted at create is accepted on `PATCH /:id` — INCLUDING the
 * status field, where the create schema declares it. That gave those resources
 * TWO routes to the same state change with DIFFERENT permissions:
 *
 *     POST  /contracts/:id/status  { to: "SIGNED" }   → the declared gate
 *     PATCH /contracts/:id         { status: "SIGNED" } → merely "edit"
 *
 * So the transition gate was optional: anyone with `edit` could take the second
 * route and skip it entirely. Tightening `POST /:id/status` without this would
 * have moved the hole rather than closed it.
 *
 * Mount this on the PATCH route, AFTER the validator. When the body does not
 * carry the lifecycle field it does nothing at all, so ordinary edits are
 * untouched. When it does, the request must satisfy the SAME permission the
 * dedicated endpoint requires for that target state.
 *
 * A caller who holds the right permission is unaffected. A caller who was
 * relying on the cheaper path now gets a 403 — which is the privilege
 * escalation being closed, not a regression.
 *
 *     router.patch("/:id",
 *       validator.update,
 *       requirePermission(MODULE, "edit"),
 *       requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }),
 *       controller.update);
 */
function requireLifecyclePermissionOnPatch(moduleKey, actionByTarget, opts = {}) {
  const field = opts.field || "status";
  const fallback = opts.fallback || "approve";
  return function lifecyclePatchRbac(req, res, next) {
    const target = req.body ? req.body[field] : undefined;
    // Not a lifecycle change — an ordinary PATCH. Nothing to add.
    if (target === undefined) return next();
    const action = actionByTarget[target] || fallback;
    return requirePermission(moduleKey, action)(req, res, next);
  };
}

module.exports = {
  requireTransitionPermission,
  requireTransitionCapability,
  requireLifecyclePermissionOnPatch,
};
