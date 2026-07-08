/**
 * Field-level confidentiality (PRD §7.3 — margins, salaries, cost rates, GL).
 * role_id x field_key -> visible|masked|hidden. Seeded defaults in
 * migrations/seeds/9020_seed_rbac_events.sql; tenant Super Admin tunes from
 * here. See capability.routes.js for the auth/RBAC wiring rationale.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./field_visibility.controller");
const validator = require("./field_visibility.validator");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "approve"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "approve"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "approve"), controller.archive);

module.exports = { basePath: "/field-visibility", feature: null, router };
