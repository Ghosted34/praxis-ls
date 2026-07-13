/** Project financing / debt (MOD-53). Gated; feature finance.debt (off by default). */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./debt.controller");
const validator = require("./debt.validator");

const MODULE = "MOD-53";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);
router.post("/:id/drawdown", requirePermission(MODULE, "approve"), validator.drawdown, controller.drawdown);
router.post("/:id/repay", requirePermission(MODULE, "approve"), validator.repay, controller.repay);

module.exports = { basePath: "/financing", feature: "finance.debt", router };
