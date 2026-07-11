/**
 * Vehicle compliance routes — RBAC-gated (MOD-40) + feature "fleet".
 * Tracks insurance / visite-technique expiry; the event engine fires renewal
 * alerts off `expires_on`.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./vehicle_compliance.controller");
const validator = require("./vehicle_compliance.validator");

const M = "MOD-40";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/vehicle-compliance", feature: "fleet", router };
