/** Currency & live FX (MOD-08). Gated + feature finance.fx. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./currency.controller");
const validator = require("./currency.validator");
const MODULE = "MOD-08";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.currencies);
router.get("/rates", requirePermission(MODULE, "view"), controller.rates);
router.get("/rate", requirePermission(MODULE, "view"), controller.rate);
router.get("/convert", requirePermission(MODULE, "view"), controller.convert);
router.post("/rates", requirePermission(MODULE, "edit"), validator.setRate, controller.setRate);
module.exports = { basePath: "/currencies", feature: "finance.fx", router };
