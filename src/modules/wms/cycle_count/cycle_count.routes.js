/**
 * Cycle count routes — RBAC-gated (MOD-38) + feature "wms.cycle_count".
 * Records physical counts and discrepancies; a certified audit report
 * (Rapport d'Audit) attaches via certified_report_vault_id.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./cycle_count.controller");
const validator = require("./cycle_count.validator");

const M = "MOD-38";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/cycle-counts", feature: "wms.cycle_count", router };
