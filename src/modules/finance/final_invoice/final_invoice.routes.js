/** Final invoice (MOD-51) — full lifecycle. Gated + feature accounting.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFieldPermission } = require("../../../shared/http/transition-permission");
const controller = require("./final_invoice.controller");
const validator = require("./final_invoice.validator");

const MODULE = "MOD-51";

/**
 * §2.7 — releasing the pricing guard is a DECISION, not an edit.
 *
 * `pricing_override` lets an invoice bill lines the dossier's accepted
 * quotation does not cover. That is the control standing in front of what a
 * client is charged, so releasing it takes `approve` plus the APPROVER
 * authority — the same pairing every other decision in the codebase uses —
 * while the route itself stays on `edit` so a pricer can still fix a typo.
 *
 * Presence-gated, so an ordinary PATCH is completely unaffected.
 */
const OVERRIDE_GATE = requireFieldPermission(MODULE, "pricing_override", "approve", {
  capability: "APPROVER",
});
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/totals", requirePermission(MODULE, "view"), controller.totals);
router.post("/", requirePermission(MODULE, "create"), validator.createDraft, OVERRIDE_GATE, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.updateDraft, OVERRIDE_GATE, controller.update);
// Submitting an invoice for approval is the author's own act, not a decision —
// requiring `approve` here meant only approvers could submit, and maker-checker
// then forbids them from approving it. See doc/PERMISSION_SWEEP_BACKLOG.md §A.
router.post("/:id/submit", requirePermission(MODULE, "edit"), validator.submit, controller.submit);

module.exports = { basePath: "/final-invoices", feature: "accounting.core", router };
