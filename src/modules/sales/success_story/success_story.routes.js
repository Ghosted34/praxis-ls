"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./success_story.controller");
const validator = require("./success_story.validator");

const MODULE = "MOD-26";
const router = express.Router();
router.use(authMiddleware);
router.get("/eligible-dossiers", requirePermission(MODULE, "view"), controller.eligible);
router.post("/generate", requirePermission(MODULE, "create"), validator.generate, controller.generate);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.post("/:id/media", requirePermission(MODULE, "edit"), validator.media, controller.uploadMedia);
router.delete("/:id/media/:documentId", requirePermission(MODULE, "edit"), controller.removeMedia);
router.post("/:id/sign-off", requirePermission(MODULE, "approve"), controller.signOff);
router.post("/:id/publish", requirePermission(MODULE, "approve"), controller.publish);
router.post("/:id/unpublish", requirePermission(MODULE, "approve"), controller.unpublish);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);

module.exports = { basePath: "/success-stories", feature: null, router };
