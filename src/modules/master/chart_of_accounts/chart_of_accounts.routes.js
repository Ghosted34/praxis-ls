/** Chart of Accounts (MOD-06). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./chart_of_accounts.controller");
const validator = require("./chart_of_accounts.validator");
const MODULE = "MOD-06";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:code", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:code", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:code", requirePermission(MODULE, "delete"), controller.remove);
module.exports = { basePath: "/chart-of-accounts", feature: null, router };
