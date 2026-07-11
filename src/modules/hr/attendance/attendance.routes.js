/** Attendance routes — RBAC-gated (MOD-14) + feature "hr".
 * Clock-in/out logs with optional GPS. POST /:id/clock-out stamps clock_out_at. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./attendance.controller");
const validator = require("./attendance.validator");

const M = "MOD-14";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/clock-out", requirePermission(M, "edit"), controller.clockOut);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/attendance", feature: null, router };
