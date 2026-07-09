/**
 * Was bare makeRouter() with no auth/RBAC gating — a pre-existing gap noted
 * in doc/RBAC_SECURITY_KICKOFF.md and doc/WORK_TO_BE_DONE.md. Gated here
 * following capability.routes.js's pattern; setting sits under its own
 * MOD-70 (Settings) catalogue entry.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./setting.controller");
const validator = require("./setting.validator");

const MODULE = "MOD-70";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/settings", feature: null, router };
