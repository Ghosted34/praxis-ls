/** Leave / allowance routes — RBAC-gated (MOD-15) + feature "hr".
 * Decision: REQUESTED → APPROVED | REJECTED via POST /:id/decision. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./leave_allowance.controller");
const validator = require("./leave_allowance.validator");

const M = "MOD-15";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/decision", requirePermission(M, "approve"), validator.decision, controller.decide);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/leave", feature: null, router };
