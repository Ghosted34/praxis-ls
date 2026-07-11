/** HR contract routes — RBAC-gated (MOD-12) + feature "hr".
 * Lifecycle: DRAFT → ISSUED → SIGNED → ENDED via POST /:id/status. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./hr_contract.controller");
const validator = require("./hr_contract.validator");

const M = "MOD-12";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/status", requirePermission(M, "edit"), validator.status, controller.setStatus);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/contracts", feature: null, router };
