/** Onboarding checklist routes — RBAC-gated (MOD-16). Per-new-hire checklists
 * built on the SOP module's onboarding tables: create → add/tick items →
 * complete, plus the TEMPLATES those checklists are raised from (0703).
 *
 * ROUTE ORDER MATTERS. `/templates`, `/items` and `/outstanding` are declared
 * BEFORE `/:id`, or the loader's uuid guard rejects them as malformed checklist
 * ids.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./onboarding.controller");
const validator = require("./onboarding.validator");

const M = "MOD-16";
const router = express.Router();
router.use(authMiddleware);

/* ── Templates (before /:id — see header) ───────────────────────────────── */
//
// Writing a template is `approve`, not `edit`, and deliberately harder than
// editing one checklist. A template decides what EVERY future hire is asked to
// do, and marking an item mandatory decides what can block a checklist from
// ever being closed — a larger authority than ticking a box on one person's
// list. Same reasoning as the house rules in sop_onboarding.
router.get("/templates", requirePermission(M, "view"), controller.listTemplates);
router.post("/templates", requirePermission(M, "approve"), validator.template, controller.createTemplate);
router.get("/templates/:templateId", requirePermission(M, "view"), controller.getTemplate);
router.patch("/templates/:templateId", requirePermission(M, "approve"), validator.templateUpdate, controller.updateTemplate);
router.post("/templates/:templateId/items", requirePermission(M, "approve"), validator.templateItem, controller.addTemplateItem);
router.patch("/templates/items/:itemId", requirePermission(M, "approve"), validator.templateItemUpdate, controller.updateTemplateItem);
router.delete("/templates/items/:itemId", requirePermission(M, "approve"), controller.removeTemplateItem);

/* ── The chase list ─────────────────────────────────────────────────────── */
router.get("/outstanding", requirePermission(M, "view"), controller.outstanding);

/* ── Checklists ─────────────────────────────────────────────────────────── */
router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
// The original tick endpoint, contract unchanged — `itemUpdate` is a superset
// of `{ is_done }`, so anything already calling this keeps working while a
// caller that wants to reassign or re-date an item can use the same route.
router.patch("/items/:itemId", requirePermission(M, "edit"), validator.itemUpdate, controller.updateItem);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.post("/:id/items", requirePermission(M, "edit"), validator.addItem, controller.addItem);
// Moving every due date is a deliberate act, not a side effect of editing a
// start date elsewhere — see the service header.
router.post("/:id/reschedule", requirePermission(M, "edit"), validator.reschedule, controller.reschedule);
router.post("/:id/complete", requirePermission(M, "edit"), controller.complete);

module.exports = { basePath: "/onboarding", feature: null, router };
