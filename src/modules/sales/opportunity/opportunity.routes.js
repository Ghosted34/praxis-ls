"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./opportunity.controller");
const validator = require("./opportunity.validator");
const MODULE = "MOD-24";

/**
 * Sales pipeline routes (MOD-24) — F7, doc/SALES_CRM_FEATURES.md.
 *
 * Stage moves are all `edit`, PRICING_IN_PROGRESS included. The pricing stage
 * is the handoff to commercial pricing, but the handoff is a convention about
 * who does the work, not a lock on who may say the work is happening — a
 * salesperson has to be able to hand a deal over without an approver in the
 * room. The guards that DO bite are elsewhere and stay: a settled opportunity
 * refuses to move at all, and win/lose are the only paths that settle one.
 */
const router = express.Router();
router.use(authMiddleware);
router.get("/board", requirePermission(MODULE, "view"), controller.board);
router.get("/metrics", requirePermission(MODULE, "view"), controller.metrics);
router.get("/stages", requirePermission(MODULE, "view"), controller.stages);
router.get("/export.csv", requirePermission(MODULE, "view"), controller.exportCsv);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/move", requirePermission(MODULE, "edit"), validator.move, controller.move);
router.post("/:id/win", requirePermission(MODULE, "edit"), validator.win, controller.win);
router.post("/:id/lose", requirePermission(MODULE, "edit"), controller.lose);
module.exports = { basePath: "/opportunities", feature: null, router };
