/** Asset routes (MOD-54). RBAC-gated fixed-asset register + depreciation. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./asset.controller");
const validator = require("./asset.validator");

const M = "MOD-54";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/depreciate", requirePermission(M, "edit"), validator.depreciate, controller.depreciate);
router.post("/:id/dispose", requirePermission(M, "approve"), validator.dispose, controller.dispose);

module.exports = { basePath: "/assets", feature: null, router };
