/** HR contract routes — RBAC-gated (MOD-12) + feature "hr".
 * Lifecycle: DRAFT → ISSUED → SIGNED → ENDED via POST /:id/status. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./hr_contract.controller");
const validator = require("./hr_contract.validator");

const M = "MOD-12";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  DRAFT: "edit",
  ISSUED: "edit",
  SIGNED: "approve",
  ENDED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

// Self-service — the caller's own contracts (My HR). No MOD grant.
router.get("/mine", controller.mine);

/* What lapses soon. `view`: knowing that six contracts expire this month is
 * ordinary management information, and gating it harder would mean the person
 * who has to act on it cannot see it. Declared before `/:id`. */
router.get("/lapsing", requirePermission(M, "view"), controller.lapsing);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint above when — and only when — the body carries it.
router.patch("/:id", requirePermission(M, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(M, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/status", validator.status, requireTransitionPermission(M, TRANSITION_ACTION, { field: "status" }), controller.setStatus);
/* DRAFTING is `edit`, not `create`: it rewrites an existing DRAFT contract and
 * the service refuses anything past that state. It does spend a model call
 * against the tenant's AI budget, which is why it is not `view`.
 *
 * There is deliberately no `/render` here. The document-template system already
 * renders and sends EMPLOYMENT_CONTRACT through the tenant's own letterhead
 * (`POST /document-templates/EMPLOYMENT_CONTRACT/:id/{generate,send}`), with the
 * signature block and the verify footer every other issued document gets. A
 * second renderer in this module would be a second letterhead to keep in step. */
router.post("/:id/draft", requirePermission(M, "edit"), validator.draft, controller.draftFor);
/* Renewal (10708): creates a NEW DRAFT contract that supersedes this one —
 * `create`, not `edit`, because it is the birth of a record, not a change to
 * one. The renewed contract's own lifecycle gates then apply as usual. */
router.post("/:id/renew", requirePermission(M, "create"), validator.renew, controller.renewFor);

router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/contracts", feature: null, router };
