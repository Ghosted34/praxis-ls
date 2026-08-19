/**
 * Pricing Variance Index (MOD-27) — read-only since §2.1. Sales list/get expose
 * ONLY R/Y/G + quote (MOD-27 view). The full finance detail (budget/actual +
 * per-line drill) is behind the finance boundary — gated on MOD-56 (General
 * Ledger) view. POST /compute is gone: the index is derived from the dossier
 * reconciliation on every read (BUG-4 — a caller could store any actual_cost —
 * is closed by having nothing to store).
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./pricing_variance.controller");

const MODULE = "MOD-27";
const FINANCE = "MOD-56";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/finance", requirePermission(FINANCE, "view"), controller.finance);

module.exports = { basePath: "/pricing-variance", feature: null, router };
