/** Cost tracking + reconciliation (MOD-47). Gated + feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./cost_tracking.controller");
const validator = require("./cost_tracking.validator");
const MODULE = "MOD-47";
const router = express.Router();
router.use(authMiddleware);
router.post("/", requirePermission(MODULE, "create"), validator.record, controller.record);
// §3.4 — the whole sheet in one transaction (legacy saved all categories at
// once; one entry per call would be 15 round trips and 15 half-saved states).
router.post("/bulk", requirePermission(MODULE, "create"), validator.bulk, controller.bulk);
// Portfolio first: Express matches in order, and while these do not collide
// with "/dossier/:dossierId" today, keeping the literal paths above the
// parameterised one is the habit that stops the next literal route from being
// swallowed silently.
router.get("/portfolio", requirePermission(MODULE, "view"), controller.portfolio);
router.get("/kpis", requirePermission(MODULE, "view"), controller.kpis);
// §3.4 — the master-ledger matrix: files × dictionary items, columns derived
// from the dictionary rather than a fixed list of 15.
router.get("/matrix", requirePermission(MODULE, "view"), controller.matrix);
router.get("/dossier/:dossierId", requirePermission(MODULE, "view"), controller.list);
router.get("/dossier/:dossierId/reconcile", requirePermission(MODULE, "view"), controller.reconcile);
// §3.4 — advances per FILE with optional per-item earmarks (owner-decided).
router.get("/dossier/:dossierId/advances", requirePermission(MODULE, "view"), controller.advances);
router.post("/advances/:advanceId/allocations", requirePermission(MODULE, "edit"), validator.advanceParam, validator.allocate, controller.allocate);
router.delete("/allocations/:allocationId", requirePermission(MODULE, "edit"), validator.allocationParam, controller.removeAllocation);
module.exports = { basePath: "/cost-tracking", feature: "costing", router };
