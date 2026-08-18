/** Régie d'avance (MOD-49) — issue/retire/query/write-off/un-age + reads. Gated + feature accounting.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./regie.controller");
const validator = require("./regie.validator");

const MODULE = "MOD-49";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
// Before /:id so "watchlist" is not swallowed as an id.
router.get("/watchlist", requirePermission(MODULE, "view"), controller.watchlist);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);

router.post("/issue", requirePermission(MODULE, "create"), validator.issue, controller.issue);

// Recording a receipt is bookkeeping against money already issued — `edit`, not
// `approve`. Gating it harder would stall the very justification the module
// exists to collect, which is what produces aged advances in the first place.
router.post("/:id/retire", requirePermission(MODULE, "edit"), validator.retire, controller.retire);
router.post("/:id/query", requirePermission(MODULE, "edit"), validator.query, controller.query);

// These three move money on a human's decision, so they sit behind `approve`
// AND, where the tenant has bound one, the workflow chain (executor.start).
router.post("/:id/write-off", requirePermission(MODULE, "approve"), validator.writeOff, controller.writeOff);
router.post("/:id/unage", requirePermission(MODULE, "approve"), validator.unage, controller.unage);
router.post("/age-due", requirePermission(MODULE, "approve"), validator.ageDue, controller.ageDue);

module.exports = { basePath: "/regie", feature: "accounting.core", router };
