/**
 * The entity/branch/department tree a user belongs to (DB_ARCHITECTURE §4.2).
 * `parent_scope_id` gives the organigramme; `user_scope` assigns users.
 * See capability.routes.js for why this wires auth/RBAC explicitly instead
 * of using the bare makeRouter() other security modules currently use.
 *
 * Membership routes added 2026-08-02 (audit finding A1): `user_scope` was read
 * by identity-cache and written by NOTHING — no endpoint, no UI, no script — so
 * no user could ever be placed in the tree and every scope-bound approval step
 * was unactionable. Handlers live in scope.members.js.
 *
 * Everything here runs on req.identityDb: scope and membership are identity
 * data, so a person's place in the company is the same under LIVE and TEST.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { asyncHandler } = require("../../../utils/errors");
const controller = require("./scope.controller");
const validator = require("./scope.validator");
const members = require("./scope.members");

const MODULE = "MOD-67";
const router = express.Router();
router.use(authMiddleware);

const actor = (req) => req.user || { user_id: null };

// The whole tree in one call — the organigramme view and the workflow step's
// scope picker both want every node, so this beats walking /scopes/:id.
// Declared BEFORE /:id so "tree" cannot be captured as an id.
// MOD-67 gated: it carries member counts, and who sits where is org information.
router.get("/tree", requirePermission(MODULE, "view"), asyncHandler(async (req, res) =>
  res.json({ data: await req.identityDb((c) => members.tree(c)) }),
));

// Department picker. NOT MOD-67 gated, deliberately: since 0490 a department IS
// a scope, so the Sales user raising a purchase request and the HR clerk adding
// an employee both have to read this list. Requiring the IAM permission for a
// form field gave ordinary staff "You don't have permission to do this" on a
// dropdown they must fill in. Names only — no member counts.
router.get("/options", asyncHandler(async (req, res) =>
  res.json({ data: await req.identityDb((c) => members.options(c)) }),
));

// The entity picker for the scope form. NOT the same as GET /entities: that one
// reads the env-selected schema, while scope.entity_id is checked against the
// identity (live) schema — under TEST the two hold different UUIDs and saving
// failed on the foreign key. Declared before /:id.
router.get("/entities", requirePermission(MODULE, "view"), asyncHandler(async (req, res) =>
  res.json({ data: await req.identityDb((c) => members.entities(c)) }),
));

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

// Membership. Assigning someone to a branch changes what they can approve, so
// it is an "edit" on the IAM module, not a lesser action.
router.get("/:id/members", requirePermission(MODULE, "view"), asyncHandler(async (req, res) =>
  res.json({ data: await req.identityDb((c) => members.listMembers(c, req.params.id)) }),
));
router.post("/:id/members", requirePermission(MODULE, "edit"), asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await req.identityDb((c) =>
      members.addMember(c, { scopeId: req.params.id, userId: req.body.user_id, actor: actor(req) })),
  }),
));
router.delete("/:id/members/:userId", requirePermission(MODULE, "edit"), asyncHandler(async (req, res) =>
  res.json({
    data: await req.identityDb((c) =>
      members.removeMember(c, { scopeId: req.params.id, userId: req.params.userId, actor: actor(req) })),
  }),
));

module.exports = { basePath: "/scopes", feature: null, router };
