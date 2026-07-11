/**
 * Warehouse location routes — RBAC-gated (MOD-34) + feature "wms".
 * Zone / aisle / rack / bin / yard slotting for the WMS.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./warehouse_location.controller");
const validator = require("./warehouse_location.validator");

const M = "MOD-34";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/locations", feature: "wms", router };
