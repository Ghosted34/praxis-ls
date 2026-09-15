/** Dashboard & KPIs (MOD-00A). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./dashboard.controller");
const MODULE = "MOD-00A";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), c.kpis);
// `/kpis` now answers legacy keys + the RESOLVED band (kpi guide §8.2) — one
// tolerant read paints the four slots and knows the picker's current state.
router.get("/kpis", requirePermission(MODULE, "view"), c.kpisWithBand);
// The picker's catalog: live ∩ eligible ∩ available, with the role's defaults
// and locks so "Restore role default" restores a truth, not a guess.
router.get("/kpi-catalog", requirePermission(MODULE, "view"), c.kpiCatalog);
// Control Tower home aggregate — operation files, live shipments, approvals.
router.get("/control-tower", requirePermission(MODULE, "view"), c.controlTower);
module.exports = { basePath: "/dashboard", feature: null, router };
