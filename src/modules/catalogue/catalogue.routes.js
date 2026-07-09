/**
 * GET /api/tenant/catalogue/modules — the full module catalogue (MOD-xx + name +
 * group), read from the platform db. Feeds the permission grant-matrix. Gated:
 * authMiddleware + MOD-67 (IAM) view.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./catalogue.controller");

const router = express.Router();
router.use(authMiddleware);
router.get("/modules", requirePermission("MOD-67", "view"), controller.listModules);

module.exports = { basePath: "/catalogue", feature: null, router };
