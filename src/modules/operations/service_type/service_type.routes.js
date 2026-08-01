/**
 * Service taxonomy (MOD-29 — see service_type.events.js for why it rides the
 * dossier's module key). Feature-gated on `operations`.
 *
 * Hand-rolled rather than makeRouter() so DELETE maps to the service's archive
 * (deactivate) rather than the kit's soft-delete: `dossier.service_type_id` is a
 * plain FK, so a real delete would either fail the constraint or strip the
 * classification off historical dossiers.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./service_type.controller");
const validator = require("./service_type.validator");
const { MODULE } = require("./service_type.events");

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/service-types", feature: "operations", router };
