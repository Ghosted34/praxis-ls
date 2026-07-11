/**
 * Inbound / GRN routes — RBAC-gated (MOD-33) + feature "wms".
 * QA gate: HOLD → PASSED (with putaway) | REJECTED via POST /:id/qa.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./inbound.controller");
const validator = require("./inbound.validator");

const M = "MOD-33";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/qa", requirePermission(M, "edit"), validator.qa, controller.setQa);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/inbound", feature: "wms", router };
