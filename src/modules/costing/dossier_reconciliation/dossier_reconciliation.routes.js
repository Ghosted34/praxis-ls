/**
 * Budget Reconciliation (MOD-76) — what an operations file actually cost, per
 * budget line, evidenced, and the cash returned to the vault.
 *
 * ── THE GRANTS, AND WHY THEY ARE NOT ALL `approve` ──────────────────────────
 *
 * Operations prepares and Finance settles (owner decision Q6, Q18), so the two
 * acts hold different grants: `edit` records what was spent, `validate` is the
 * finance visa that settles it. 12771 created `can_validate` precisely so that
 * "may approve a spend" and "may sign off the accounting for that spend" could
 * be held apart — the one pair maker-checker most wants separated.
 *
 * MOD-76 rather than MOD-47 for the same reason (Q21): MOD-47 is cost tracking,
 * and sharing the key meant a grant to record costs was also a grant to settle
 * a file's reconciliation.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./dossier_reconciliation.controller");
const v = require("./dossier_reconciliation.validator");

const M = "MOD-76";
const router = express.Router();
router.use(authMiddleware);

/**
 * What the CALLER personally owes. Deliberately ungated — the same rule
 * hr_query's `/mine` applies: a person may always see their own obligations,
 * and requiring a module grant to be told "you owe three receipts" would hide
 * the debt from exactly the person who can clear it.
 *
 * Declared before `/:dossierId` so the literal wins over the uuid pattern.
 */
router.get("/owed", c.owedMine);
router.get("/owed/all", requirePermission(M, "view"), c.owedAll);

// The sheet. Keyed on the DOSSIER, not on a reconciliation id: there is exactly
// one per file (Q6) and a caller that has the file should not have to look up
// an id that is guaranteed to be derivable from it.
router.get("/:dossierId", requirePermission(M, "view"), v.dossierParam, c.sheet);

// Recording what was spent — Operations' work.
router.patch("/:dossierId/lines/:costingLineId", requirePermission(M, "edit"), v.lineParam, v.patchLine, c.patchLine);
router.post("/:dossierId/reasons", requirePermission(M, "edit"), v.dossierParam, v.applyReason, c.applyReason);
router.post("/:dossierId/lines/:costingLineId/documents", requirePermission(M, "edit"), v.lineParam, v.attachDocument, c.attachDocument);
router.delete("/:dossierId/lines/:costingLineId/documents/:docId", requirePermission(M, "edit"), v.docParam, c.detachDocument);
router.post("/:dossierId/submit", requirePermission(M, "edit"), v.dossierParam, v.submit, c.submit);

// Finance's visa. `validate`, not `approve`: settling is not an approval, and
// the MD is told rather than asked (Q6).
router.post("/:dossierId/reject", requirePermission(M, "validate"), v.dossierParam, v.reject, c.reject);
router.post("/:dossierId/settle", requirePermission(M, "validate"), v.dossierParam, v.settle, c.settle);

module.exports = { basePath: "/costing/reconciliations", feature: null, router };
