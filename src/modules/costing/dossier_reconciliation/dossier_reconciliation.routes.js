/**
 * OCR — Operational Cost Reconciliation (G19), MOD-47. The controlled
 * document: draft from the file's costings, submit for review, validate
 * (writes the agreed amount back onto the dossier) or reject with a reason.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./dossier_reconciliation.controller");
const v = require("./dossier_reconciliation.validator");

const M = "MOD-47";
const router = express.Router();
router.use(authMiddleware);

// Read routes.
router.get("/", requirePermission(M, "view"), c.latest);
router.get("/:id", requirePermission(M, "view"), c.get);

// Lifecycle — create/submit are edit, validate/reject are approve (maker-
// checker: the person who validates must hold a grant the submitter need not).
router.post("/", requirePermission(M, "edit"), v.create, c.create);
router.post("/:id/submit", requirePermission(M, "edit"), v.idParam, c.submit);
router.post("/:id/validate", requirePermission(M, "approve"), v.idParam, c.validate);
router.post("/:id/reject", requirePermission(M, "approve"), v.reject, c.reject);

// AI match proposals (§2.1) — deciding a proposed mapping is a human edit on
// the DRAFT. The assistant may create PROPOSED rows at draft time but has no
// path to these routes: confirming is the act of taking responsibility.
router.post("/:id/suggestions/:sid/confirm", requirePermission(M, "edit"), v.suggestionParam, c.confirmSuggestion);
router.post("/:id/suggestions/:sid/reject", requirePermission(M, "edit"), v.suggestionParam, c.rejectSuggestion);

module.exports = { basePath: "/costing/reconciliations", feature: null, router };
