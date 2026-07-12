/** Settings hub (MOD-70) — tenant self-config. Gated; writes need MOD-70 edit. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./setting.controller");
const validator = require("./setting.validator");

const MODULE = "MOD-70";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.all);
router.get("/sections", requirePermission(MODULE, "view"), controller.sections);
router.get("/:section", requirePermission(MODULE, "view"), controller.section);
router.get("/:section/:key", requirePermission(MODULE, "view"), controller.get);
router.put("/:section/:key", requirePermission(MODULE, "edit"), validator.put, controller.put);
router.delete("/:section/:key", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/settings", feature: null, router };
