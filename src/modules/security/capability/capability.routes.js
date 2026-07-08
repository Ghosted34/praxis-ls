/**
 * The authority overlay (ISSUER/VALIDATOR/APPROVER/LINE_MANAGER — DB_ARCHITECTURE
 * §4.2). Seeded via migrations/seeds/9020_seed_rbac_events.sql; tenants rarely
 * add new ones, but Super Admin can via this endpoint.
 *
 * Unlike iam_role/session (which use makeRouter() with no auth/RBAC gating —
 * a pre-existing gap, see doc/RBAC_SECURITY_KICKOFF.md), this module wires
 * authMiddleware + requirePermission per CONVENTIONS.md's stated rule
 * ("RBAC: gate writes with the tenant RBAC check"), one action per verb.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./capability.controller");
const validator = require("./capability.validator");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/capabilities", feature: null, router };
