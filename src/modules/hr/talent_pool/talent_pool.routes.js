/** Talent pool routes — RBAC-gated (MOD-19) + feature "hr". */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./talent_pool.controller");
const validator = require("./talent_pool.validator");

const M = "MOD-19";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/talent-pool", feature: null, router };
