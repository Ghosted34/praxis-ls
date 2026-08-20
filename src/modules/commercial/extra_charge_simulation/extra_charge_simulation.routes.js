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
// §3.2 — the persisted Rate Configuration, saved FROM the simulator screen.
// Placement is the legacy's (one click from the calculation, recalculating
// live); persistence is not (its save was alert("Saved locally!") and a lost
// edit). Gated on the tenant-settings module: the pricer VIEWS the tariff
// (GET above, MOD-28 view); changing a business rule every simulation uses is
// a settings edit (MOD-70), whoever's screen the button sits on.
router.put("/rates", requirePermission("MOD-70", "edit"), validator.saveRates, controller.saveRates);
// §3.2 — prefill from the file: containers, ATA, shipping line.
router.get("/prefill/:dossierId", requirePermission(MODULE, "view"), validator.dossierParam, controller.prefill);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/preview", requirePermission(MODULE, "view"), validator.compute, controller.preview);
router.post("/", requirePermission(MODULE, "create"), validator.compute, controller.create);

module.exports = { basePath: "/extra-charge-simulations", feature: null, router };
