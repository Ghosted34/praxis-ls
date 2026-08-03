/** Quotation (MOD-27). Gated; feature commercial.quotation. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./quotation.controller");
const validator = require("./quotation.validator");

const MODULE = "MOD-27";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// Sending your own quotation out is not a decision; accepting or rejecting one
// is. See shared/http/transition-permission.js.
const TRANSITION_ACTION = { SENT: "edit", CONVERTED: "edit", EXPIRED: "edit", ACCEPTED: "approve", REJECTED: "approve" };

router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
router.post("/:id/accept", requirePermission(MODULE, "approve"), validator.accept, controller.accept);

module.exports = { basePath: "/quotations", feature: "commercial.quotation", router };
