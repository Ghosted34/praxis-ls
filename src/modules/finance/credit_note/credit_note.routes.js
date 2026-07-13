/** Credit note (MOD-51) — reverses a FINAL invoice. Gated + feature accounting.core. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./credit_note.controller");
const validator = require("./credit_note.validator");

const MODULE = "MOD-51";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/post", requirePermission(MODULE, "approve"), validator.post, controller.post);

module.exports = { basePath: "/credit-notes", feature: "accounting.core", router };
