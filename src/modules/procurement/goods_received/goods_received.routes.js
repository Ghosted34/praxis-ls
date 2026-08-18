/** Goods Received Note (MOD-61). Gated; feature procurement.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./goods_received.controller");
const validator = require("./goods_received.validator");

const MODULE = "MOD-61";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
// Handing the received goods to the warehouse creates a WMS inbound — the
// record's own act, so `edit` (like recording the GRN).
router.post("/:id/send-to-warehouse", requirePermission(MODULE, "edit"), validator.sendToWarehouse, controller.sendToWarehouse);

module.exports = { basePath: "/goods-received", feature: null, router };
