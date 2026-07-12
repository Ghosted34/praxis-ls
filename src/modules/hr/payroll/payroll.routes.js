/**
 * Payroll routes (MOD-17). RBAC-gated. SoD: compute (edit) and approval
 * transitions (approve) are separate permissions so the same person can't both
 * run and validate payroll.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./payroll.controller");
const validator = require("./payroll.validator");

const M = "MOD-17";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.post("/", requirePermission(M, "create"), validator.createRun, controller.create);
router.post("/:id/compute", requirePermission(M, "edit"), validator.compute, controller.compute);
router.post("/:id/status", requirePermission(M, "approve"), validator.status, controller.setStatus);

module.exports = { basePath: "/payroll", feature: null, router };
