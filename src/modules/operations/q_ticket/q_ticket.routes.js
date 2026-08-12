/** Q tickets (MOD-31) — client queries raised against a milestone. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./q_ticket.controller");
const validator = require("./q_ticket.validator");
const MODULE = "MOD-31";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.detail);
// Staff can raise one too — a query that arrives by phone still belongs on the file.
router.post("/", requirePermission(MODULE, "create"), validator.raise, controller.raise);
router.post("/:id/replies", requirePermission(MODULE, "edit"), validator.reply, controller.reply);
router.post("/:id/resolve", requirePermission(MODULE, "edit"), validator.resolve, controller.resolve);
module.exports = { basePath: "/q-tickets", feature: "operations", router };
