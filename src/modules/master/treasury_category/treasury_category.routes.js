/**
 * Treasury categories (MOD-09) — the user-editable registry of treasury
 * account types (Bank, Cash, Petty Cash, MTN MoMo, Orange Money, Airtel
 * SmartCash …). See migrations/tenant/0520_treasury_master_rich.sql.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./treasury_category.controller");
const validator = require("./treasury_category.validator");

const MODULE = "MOD-09";

const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/",   requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/active", requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/treasury-categories", feature: null, router };
