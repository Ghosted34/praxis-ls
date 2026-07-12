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
router.get("/kpis", requirePermission(MODULE, "view"), c.kpis);
module.exports = { basePath: "/dashboard", feature: null, router };
