/** Extra-charge / demurrage simulator (MOD-28) — rapid quote, no GL. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./extra_charge_simulation.controller");
const validator = require("./extra_charge_simulation.validator");

const MODULE = "MOD-28";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
// Before /:id — "rates" is not a uuid, but the router does not know that.
router.get("/rates", requirePermission(MODULE, "view"), controller.rates);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/preview", requirePermission(MODULE, "view"), validator.compute, controller.preview);
router.post("/", requirePermission(MODULE, "create"), validator.compute, controller.create);

module.exports = { basePath: "/extra-charge-simulations", feature: null, router };
