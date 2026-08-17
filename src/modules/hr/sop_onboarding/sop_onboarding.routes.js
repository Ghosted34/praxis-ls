/** SOP document routes — RBAC-gated (MOD-16) + feature "hr". Standard operating
 * procedures with versioning, plus the HOUSE RULES those procedures are
 * enforced by (0697).
 *
 * ── WHY THE RULES ARE GATED HARDER THAN THE DOCUMENTS ─────────────────────
 *
 * Reading a rule is `view` — an employee's manager should be able to see what
 * the company charges for, and hiding it would mean citing a clause nobody can
 * look up. WRITING one is `approve`, not `edit`: a rule decides what comes out
 * of everybody's pay, which is a larger authority than editing the PDF that
 * describes it, and materially larger than any other write in this module.
 *
 * Literal `/rules` paths are declared BEFORE `/:id` or the loader's uuid guard
 * rejects them as malformed SOP ids.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./sop_onboarding.controller");
const validator = require("./sop_onboarding.validator");

const M = "MOD-16";
const router = express.Router();
router.use(authMiddleware);

router.get("/rules", requirePermission(M, "view"), controller.listRules);
router.post("/rules", requirePermission(M, "approve"), validator.rule, controller.createRule);
router.get("/rules/:id", requirePermission(M, "view"), controller.getRule);
router.patch("/rules/:id", requirePermission(M, "approve"), validator.ruleUpdate, controller.updateRule);
router.delete("/rules/:id", requirePermission(M, "approve"), controller.archiveRule);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
// Drafting is `edit` — it writes the procedure's text. Rendering the PDF is
// `approve`: the rendered file is what gets circulated and pinned to a notice
// board, and issuing a procedure is a larger act than typing one.
router.post("/:id/draft", requirePermission(M, "edit"), validator.draft, controller.draft);
router.post("/:id/render", requirePermission(M, "approve"), controller.renderPdf);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/sops", feature: null, router };
