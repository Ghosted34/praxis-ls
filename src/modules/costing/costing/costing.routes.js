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
// Literal segments before "/:id", or "suggest" and "kpis" parse as costing ids.
//
// Both need only `view`. `suggest` in particular WRITES NOTHING — it reads the
// service type's tiered charge set and prices it — so gating it on `create`
// would stop a validator seeing what the author was offered.
//
// It also resolves expense rates server-side, deliberately: the client used to
// call `GET /expense-rates/resolve` once per line, which is N round trips AND
// requires the caller to hold MOD-10 (Expense Rates) just to have a costing
// price itself. One call, gated on the module that owns the document.
router.get("/suggest", requirePermission(MODULE, "view"), validator.suggestQuery, controller.suggest);
router.get("/kpis", requirePermission(MODULE, "view"), validator.listQuery, controller.kpis);
router.get("/", requirePermission(MODULE, "view"), validator.listQuery, controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
// The budget ledger (12771). `view` on the costing, not on MOD-49: this is the
// SHEET telling you what is left of it, and the cash-request worksheet reads it
// to seed and to warn. Declared after "/:id" — a distinct sub-path, so no
// ambiguity with a costing id.
router.get("/:id/budget", requirePermission(MODULE, "view"), validator.budgetQuery, controller.budget);
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
// The unlock loop (10718) — the way out of APPROVED_LOCKED.
//
// Gated on `action` rather than `to`, and the split mirrors SUBMIT vs APPROVE
// above: asking to reopen is an author's act (`edit`), while granting or
// refusing is a decision (`approve` + the APPROVER capability). The legacy role
// lists are NOT ported — hardcoded role names are strictly less expressive than
// module grants plus the SoD overlay, and CEO already bypasses both.
const UNLOCK_ACTION = { REQUEST_UNLOCK: "edit", UNLOCK: "approve", DENY_UNLOCK: "approve" };
const UNLOCK_CAPABILITY = { UNLOCK: "APPROVER", DENY_UNLOCK: "APPROVER" };

router.post(
  "/:id/unlock",
  validator.unlock,
  requireTransitionPermission(MODULE, UNLOCK_ACTION, { field: "action" }),
  requireTransitionCapability(UNLOCK_CAPABILITY, { field: "action" }),
  controller.unlock,
);
module.exports = { basePath: "/costings", feature: "costing", router };
