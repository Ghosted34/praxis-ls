/**
 * Driver licence routes — RBAC-gated (MOD-44) + feature "fleet".
 * Backs the driver_license table; the event engine fires expiry alerts off
 * `expires_on`.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./driver.controller");
const validator = require("./driver.validator");

const M = "MOD-44";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.get("/expiring", requirePermission(M, "view"), controller.expiring);
router.post("/scan", requirePermission(M, "edit"), controller.scan);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/drivers", feature: "fleet", router };
