/** Project costing (MOD-46). Gated + feature costing. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./costing.controller");
const validator = require("./costing.validator");
const MODULE = "MOD-46";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
// SUBMIT_* are the author sending their costing on; APPROVE/REJECT are the
// decision. See shared/http/transition-permission.js.
const TRANSITION_ACTION = { SUBMIT_VALIDATION: "edit", SUBMIT_APPROVAL: "edit", APPROVE: "approve", REJECT: "approve" };

router.post("/:id/status", validator.setStatus, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.setStatus);
module.exports = { basePath: "/costings", feature: "costing", router };
