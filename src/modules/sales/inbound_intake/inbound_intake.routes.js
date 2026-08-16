"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./inbound_intake.controller");
const validator = require("./inbound_intake.validator");
const MODULE = "MOD-25";

/**
 * Inbound intake routes — the contact enquiry desk (F9,
 * doc/SALES_CRM_FEATURES.md), plus the partnership endpoints F10 is moving into
 * its own module.
 *
 * PER-STATE RBAC. Reading, answering and closing an enquiry are all `edit`, and
 * this is a deliberate departure from the F6 pattern where the state that ENDS
 * the record needs `approve`. CLOSED is not terminal here — rules.NEXT reopens
 * it to READ — so closing is a reversible tidy-up, not a decision. Requiring
 * `approve` to close a piece of junk mail would mean nobody clears the desk.
 * Anything unmapped still falls back to `approve`, so a state added later fails
 * closed.
 */
const TRANSITION_ACTION = {
  READ: "edit",
  RESPONDED: "edit",
  CLOSED: "edit",
};

const router = express.Router();
router.use(authMiddleware);

/* ─── enquiries ───────────────────────────────────────────────────────────── */

router.get("/enquiries", requirePermission(MODULE, "view"), controller.listEnquiries);
router.get("/enquiries/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
// The tile and type vocabulary the register renders, so the screen does not keep
// its own copy of the status list and drift from the one the API partitions on.
router.get("/enquiries/tiles", requirePermission(MODULE, "view"), controller.tiles);
router.get("/enquiries/:id", requirePermission(MODULE, "view"), controller.getEnquiry);

router.post("/enquiries", requirePermission(MODULE, "create"), validator.enquiry, controller.createEnquiry);
router.patch("/enquiries/:id", requirePermission(MODULE, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }), controller.updateEnquiry);

// Opening the drawer marks NEW -> READ. `edit` rather than `view`: it writes.
router.post("/enquiries/:id/read", requirePermission(MODULE, "edit"), controller.markRead);
router.post("/enquiries/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/enquiries/:id/respond", requirePermission(MODULE, "edit"), validator.respond, controller.respond);
router.post("/enquiries/:id/triage", requirePermission(MODULE, "edit"), validator.triage, controller.triage);

/* ─── partnership requests ────────────────────────────────────────────────
 *
 * MOVED in F10 to src/modules/sales/partnership_request/ (basePath
 * /partnership-requests). F9 left these here marked "F10 territory"; this is
 * F10 collecting them.
 *
 * They could not stay: migration 0688 replaces the table's status vocabulary
 * with the legacy API's own NEW / IN_REVIEW / APPROVED / REJECTED, so the
 * `review` validator below — REVIEWING / ACCEPTED / DECLINED — now writes
 * values the CHECK constraint refuses. An endpoint that 23514s on every call
 * is not a back-compatible alias.
 *
 * Triage still raises a partnership request: it does it through
 * partnership_request.repo, above, which is the F10 register.
 */

// MOVED 2026-08-04 — audit API F-6. This mounted on "/inbound", the same
// basePath as wms/inbound. Two unrelated products shared one namespace and only
// worked because their path sets happened to be disjoint and sales was
// discovered first; the module-loader now fails at boot on any such collision.
//
// It was already observably wrong: with WMS disabled for a tenant,
// GET /inbound 403'd FEATURE_DISABLED while GET /inbound/enquiries returned 200
// on the same prefix, and the two enforced different permission modules
// (MOD-25 here, MOD-33 there) on one URL space.
//
// BREAKING: /api/tenant/inbound/{enquiries,partnerships}* are now
//           /api/tenant/intake/{enquiries,partnerships}*
// Client updated in the same commit (client/src/features/sales/pages.tsx).
// WMS keeps /inbound, which is the one that matches its module name.
//
// F9 KEPT THIS PREFIX rather than moving the desk to /enquiries. A second live
// URL for the same register — the old one still answering with three statuses
// and no KPI — is precisely the "two ways to compute the same thing" defect
// this build exists to remove, and a rename would have created one for as long
// as any caller lagged behind.
module.exports = { basePath: "/intake", feature: null, router };
