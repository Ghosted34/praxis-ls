/**
 * Read-only by design (the immutable ledger has no HTTP write path — rows
 * only ever come from the audit() helper called internally by services).
 * Was ungated makeRouter()-free custom router with no auth/RBAC at all — a
 * pre-existing gap noted in doc/RBAC_SECURITY_KICKOFF.md and
 * doc/WORK_TO_BE_DONE.md. Gated here under its own MOD-69 (Immutable
 * Ledger) catalogue entry, view only (there's nothing to create/edit/
 * delete/approve here).
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./audit_ledger.controller");
const validator = require("./audit_ledger.validator");

const MODULE = "MOD-69";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), c.list);
// Registered before "/:id" so "soft-deletes" isn't swallowed as an :id param.
router.get("/soft-deletes", requirePermission(MODULE, "view"), c.listSoftDeletes);

// Security-events read (4.2) + access reviews (4.1). All literal paths, so they
// must precede the "/:id" ledger-entry route below.
router.get("/events", requirePermission(MODULE, "view"), c.listSecurityEvents);
router.get("/reviews", requirePermission(MODULE, "view"), c.listReviews);
router.post("/reviews", requirePermission(MODULE, "create"), validator.reviewCreate, c.createReview);
router.get("/reviews/:id", requirePermission(MODULE, "view"), c.getReview);
router.patch("/reviews/:id", requirePermission(MODULE, "edit"), c.completeReview);
router.patch("/reviews/:id/entries/:entryId", requirePermission(MODULE, "edit"), validator.entryDecision, c.decideEntry);
router.post(
  "/soft-deletes/:id/request-restore",
  requirePermission(MODULE, "edit"),
  c.requestRestore,
);
// "approve" verb — restore is the second-admin confirmation step of a
// maker-checker pair, the same authority tier as approving a document.
router.post("/soft-deletes/:id/restore", requirePermission(MODULE, "approve"), c.restore);
router.get("/:id", requirePermission(MODULE, "view"), c.get);

module.exports = { basePath: "/audit", feature: null, router };
