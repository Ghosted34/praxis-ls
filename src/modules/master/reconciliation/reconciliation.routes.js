/**
 * Treasury reconciliation (MOD-09) — statement ingest, matching, the etat de
 * rapprochement, and the petty-cash census.
 *
 * Rides MOD-09 (the treasury permission) rather than minting a permission of
 * its own: reconciling an account is a treasury duty, held by the same
 * Finance/Treasury/Accountant roles that manage the accounts themselves, and a
 * separate key would have to be granted to every one of them on day one.
 *
 * PERMISSION GRADING within the module is deliberate:
 *   view    reads
 *   create  importing a statement, running the matcher, recording a count
 *   edit    confirming a mapping, confirming/rejecting a match, attesting
 *   approve signing off a reconciliation — the act with accounting consequence
 */
"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./reconciliation.controller");
const v = require("./reconciliation.validator");

const MODULE = "MOD-09";
const router = express.Router();
router.use(authMiddleware);

/* ── statement profiles — the saved column maps ─────────────────────────── */
router.get("/profiles", requirePermission(MODULE, "view"), c.listProfiles);
router.post("/profiles", requirePermission(MODULE, "edit"), v.profileConfirm, c.confirmProfile);

/* ── ingest ─────────────────────────────────────────────────────────────── */
// Preview writes nothing, but it parses an uploaded file and can propose a
// mapping, so it is gated at `create` rather than `view`.
router.post("/statements/preview", requirePermission(MODULE, "create"), v.preview, c.preview);
router.post("/statements", requirePermission(MODULE, "create"), v.import, c.importStatement);
router.get("/statements", requirePermission(MODULE, "view"), c.listStatements);
router.get("/statements/:id", requirePermission(MODULE, "view"), c.getStatement);

/* ── matching ───────────────────────────────────────────────────────────── */
router.post("/statements/:id/match", requirePermission(MODULE, "create"), v.matchRun, c.runMatcher);
router.get("/lines/:lineId/matches", requirePermission(MODULE, "view"), c.lineMatches);
router.post("/lines/:lineId/ignore", requirePermission(MODULE, "edit"), v.ignoreLine, c.ignoreLine);
router.post("/matches", requirePermission(MODULE, "edit"), v.manualMatch, c.manualMatch);
router.post("/matches/:matchId/confirm", requirePermission(MODULE, "edit"), c.confirmMatch);
router.post("/matches/:matchId/reject", requirePermission(MODULE, "edit"), v.matchReject, c.rejectMatch);

/* ── the etat de rapprochement ──────────────────────────────────────────── */
router.get("/", requirePermission(MODULE, "view"), c.listReconciliations);
router.post("/", requirePermission(MODULE, "create"), v.buildReconciliation, c.buildReconciliation);
// Declared before "/:id" so a literal segment is never captured as an id.
router.get("/cash-counts", requirePermission(MODULE, "view"), c.listCashCounts);
router.post("/cash-counts", requirePermission(MODULE, "create"), v.cashCount, c.recordCashCount);
router.post("/cash-counts/:id/attest", requirePermission(MODULE, "edit"), v.attestCashCount, c.attestCashCount);
router.post("/cash-counts/:id/document", requirePermission(MODULE, "view"), c.renderCashCountDocument);
router.get("/:id", requirePermission(MODULE, "view"), c.getReconciliation);
router.post("/:id/approve", requirePermission(MODULE, "approve"), c.approveReconciliation);
// Issuing the document is a `view` act, not an `approve` one: it renders what
// the record already says. Whether it says DRAFT across the top is decided by
// the record's status, not by who asked for it.
router.post("/:id/document", requirePermission(MODULE, "view"), c.renderReconciliationDocument);

module.exports = { basePath: "/reconciliation", feature: null, router };
