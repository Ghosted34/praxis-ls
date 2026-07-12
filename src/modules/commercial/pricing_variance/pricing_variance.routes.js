/**
 * Pricing Variance Index (MOD-27). Sales list/get expose ONLY R/Y/G + quote
 * (MOD-27 view). Computing the index and the full finance detail (actual_cost)
 * are behind the finance boundary — gated on MOD-56 (General Ledger) view.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./pricing_variance.controller");
const validator = require("./pricing_variance.validator");

const MODULE = "MOD-27";
const FINANCE = "MOD-56";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/finance", requirePermission(FINANCE, "view"), controller.finance);
router.post("/compute", requirePermission(FINANCE, "view"), validator.compute, controller.compute);

module.exports = { basePath: "/pricing-variance", feature: null, router };
