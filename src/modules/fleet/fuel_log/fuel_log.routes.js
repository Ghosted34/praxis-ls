/**
 * Fuel log routes — RBAC-gated (MOD-43) + feature "fleet".
 * Ledger posting (entry_id → COA 6053 tagged to dossier) is deferred until
 * Phase 1 journal posting lands.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./fuel_log.controller");
const validator = require("./fuel_log.validator");

const M = "MOD-43";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/fuel", feature: "fleet", router };
