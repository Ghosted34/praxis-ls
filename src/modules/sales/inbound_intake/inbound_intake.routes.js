"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./inbound_intake.controller");
const validator = require("./inbound_intake.validator");
const MODULE = "MOD-25";
const router = express.Router();
router.use(authMiddleware);
router.get("/enquiries", requirePermission(MODULE, "view"), controller.listEnquiries);
router.post("/enquiries", requirePermission(MODULE, "create"), validator.enquiry, controller.createEnquiry);
router.post("/enquiries/:id/triage", requirePermission(MODULE, "edit"), validator.triage, controller.triage);
router.get("/partnerships", requirePermission(MODULE, "view"), controller.listPartnerships);
router.post("/partnerships", requirePermission(MODULE, "create"), validator.partnership, controller.createPartnership);
router.post("/partnerships/:id/review", requirePermission(MODULE, "edit"), validator.review, controller.reviewPartnership);
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
module.exports = { basePath: "/intake", feature: null, router };
