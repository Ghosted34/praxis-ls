/** Reporting & Insights (MOD-63). Gated; feature reporting. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./report.controller");
const validator = require("./report.validator");

const MODULE = "MOD-63";
const router = express.Router();
router.use(authMiddleware);
router.get("/catalogue", requirePermission(MODULE, "view"), controller.catalogue);
router.get("/run/:key", requirePermission(MODULE, "view"), controller.run);
router.get("/saved", requirePermission(MODULE, "view"), controller.listSaved);
router.post("/saved", requirePermission(MODULE, "create"), validator.save, controller.save);
router.get("/saved/:id/run", requirePermission(MODULE, "view"), controller.runSaved);
router.delete("/saved/:id", requirePermission(MODULE, "delete"), controller.deleteSaved);
router.get("/tiles", requirePermission(MODULE, "view"), controller.tiles);
router.put("/tiles", requirePermission(MODULE, "edit"), validator.setTile, controller.setTile);

module.exports = { basePath: "/reports", feature: "reporting", router };
