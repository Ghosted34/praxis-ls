/**
 * Was bare makeRouter() with no auth/RBAC gating — a pre-existing gap noted
 * in doc/RBAC_SECURITY_KICKOFF.md and doc/WORK_TO_BE_DONE.md. Gated here
 * following capability.routes.js's pattern; session sits under its own
 * MOD-68 (Session Management) catalogue entry.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./session.controller");
const validator = require("./session.validator");

const MODULE = "MOD-68";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
// /mine and /:id/kill are self-scoped (no MOD-68 grant needed for your own
// sessions — see session.service.js) — registered before "/:id" so "mine"
// isn't swallowed as an :id param.
router.get("/mine", controller.mine);
router.post("/mine/revoke-all", controller.killAllMine);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);
router.post("/:id/kill", controller.kill);

module.exports = { basePath: "/sessions", feature: null, router };
