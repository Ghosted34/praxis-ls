/**
 * HR queries. Self-service (any authenticated user, scoped to their own employee):
 *   GET  /hr/queries/mine
 *   POST /hr/queries/:id/respond
 * HR admin (MOD-71 grant; CEO bypasses):
 *   GET/POST/GET:id/PATCH:id/DELETE:id
 * The literal /mine is registered before /:id so it can't be captured as an id.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./hr_query.controller");
const validator = require("./hr_query.validator");

const M = "MOD-71";
const router = express.Router();
router.use(authMiddleware);

// Self-service — no MOD grant (you always see/answer your own).
router.get("/mine", controller.mine);
router.post("/:id/respond", validator.respond, controller.respond);

// HR admin.
router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/hr/queries", feature: null, router };
