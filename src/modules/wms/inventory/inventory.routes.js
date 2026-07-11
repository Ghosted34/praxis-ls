/**
 * Inventory routes — RBAC-gated (MOD-35) + feature "wms.inventory".
 * State machine: AVAILABLE → QA_HOLD / ALLOCATED / DAMAGED → DISPATCHED.
 * POST /:id/state changes state; POST /:id/move journals a stock movement and
 * adjusts qty/location; GET /:id/movements reads the movement journal.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./inventory.controller");
const validator = require("./inventory.validator");

const M = "MOD-35";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.get("/:id/movements", requirePermission(M, "view"), controller.movements);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/state", requirePermission(M, "edit"), validator.state, controller.setState);
router.post("/:id/move", requirePermission(M, "edit"), validator.move, controller.move);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/inventory", feature: "wms.inventory", router };
