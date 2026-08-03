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

const { requirePermission } = require("../../middleware/rbac");

function requireTransitionPermission(moduleKey, actionByTarget, opts = {}) {
  const field = opts.field || "to";
  const fallback = opts.fallback || "approve";
  return function transitionRbac(req, res, next) {
    const target = req.body ? req.body[field] : undefined;
    const action = actionByTarget[target] || fallback;
    return requirePermission(moduleKey, action)(req, res, next);
  };
}

module.exports = { requireTransitionPermission };
