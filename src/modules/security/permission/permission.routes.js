/**
 * The grant-matrix editor. Deliberately gated tighter than the other new
 * security modules: only 'approve' can touch this (editing permissions is
 * itself the highest-leverage write in the system), not 'edit'/'create'.
 * See capability.routes.js for why auth/RBAC is wired explicitly here.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./permission.controller");
const validator = require("./permission.validator");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
// The full grant set for the matrix editor. GET / is paginated at 50 rows, which
// is fewer than the default seed writes — an editor loading through it can't see
// most grants and overwrites them blind. Before /:id so "matrix" isn't taken as
// an id.
router.get("/matrix", requirePermission(MODULE, "view"), controller.matrix);
router.post("/", requirePermission(MODULE, "approve"), validator.create, controller.create);
// Grant-matrix upsert by (role_id, module_key). Before /:id so "grant" isn't
// swallowed as an :id param (different verb anyway, but explicit is safer).
router.put("/grant", requirePermission(MODULE, "approve"), validator.grant, controller.upsertGrant);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "approve"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "approve"), controller.archive);

module.exports = { basePath: "/permissions", feature: null, router };
