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

// Reads. Static paths are declared before the `/:code/360` param route; they are
// single-segment and it is two, so there is no capture, but order keeps it clear.
router.get("/", requirePermission(MODULE, "view"), controller.currencies);
router.get("/rates", requirePermission(MODULE, "view"), controller.rates);
router.get("/rate", requirePermission(MODULE, "view"), controller.rate);
router.get("/convert", requirePermission(MODULE, "view"), controller.convert);
router.get("/:code/360", requirePermission(MODULE, "view"), controller.dossier);

// Writes — currency master.
router.post("/", requirePermission(MODULE, "edit"), validator.addCurrency, controller.addCurrency);
router.post("/base", requirePermission(MODULE, "edit"), validator.setBase, controller.setBase);
router.post("/sync", requirePermission(MODULE, "edit"), controller.syncNow);
router.patch("/:code", requirePermission(MODULE, "edit"), validator.editCurrency, controller.editCurrency);
router.delete("/:code", requirePermission(MODULE, "delete"), controller.removeCurrency);

// Writes — FX rates (manual overrides, as-of dated).
router.post("/rates", requirePermission(MODULE, "edit"), validator.setRate, controller.setRate);

module.exports = { basePath: "/currencies", feature: "finance.fx", router };
