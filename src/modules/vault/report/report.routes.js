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

// Scheduled reports (1.3). run-due is registered before the :id routes so the
// literal path can't be captured as an :id.
router.post("/scheduled/run-due", requirePermission(MODULE, "create"), controller.runDue);
router.get("/scheduled", requirePermission(MODULE, "view"), controller.listScheduled);
router.post("/scheduled", requirePermission(MODULE, "create"), validator.schedule, controller.createSchedule);
router.patch("/scheduled/:id", requirePermission(MODULE, "edit"), validator.scheduleUpdate, controller.updateSchedule);
router.delete("/scheduled/:id", requirePermission(MODULE, "delete"), controller.deleteSchedule);

module.exports = { basePath: "/reports", feature: "reporting", router };
