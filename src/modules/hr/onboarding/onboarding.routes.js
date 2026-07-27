/** Onboarding checklist routes — RBAC-gated (MOD-16). Per-new-hire checklists
 * built on the SOP module's onboarding tables: create → add/tick items → complete. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./onboarding.controller");
const validator = require("./onboarding.validator");

const M = "MOD-16";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.patch("/items/:itemId", requirePermission(M, "edit"), validator.toggle, controller.toggleItem);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.post("/:id/items", requirePermission(M, "edit"), validator.addItem, controller.addItem);
router.post("/:id/complete", requirePermission(M, "edit"), controller.complete);

module.exports = { basePath: "/onboarding", feature: null, router };
