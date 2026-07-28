/** Document-template Studio routes — RBAC-gated (MOD-70 Settings). List templates,
 * read/save per-(docType, entity) config, list records for the preview picker,
 * live HTML preview, and generate a real vaulted PDF. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./template.controller");
const validator = require("./template.validator");

const M = "MOD-70";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(M, "view"), controller.list);
router.get("/:docType/config", requirePermission(M, "view"), controller.getConfig);
router.put("/:docType/config", requirePermission(M, "edit"), validator.setConfig, controller.setConfig);
router.get("/:docType/records", requirePermission(M, "view"), controller.records);
router.post("/:docType/preview", requirePermission(M, "view"), validator.preview, controller.preview);
router.post("/:docType/generate", requirePermission(M, "edit"), validator.preview, controller.generate);
router.post("/:docType/:id/send", requirePermission(M, "edit"), validator.sendDoc, controller.send);

module.exports = { basePath: "/document-templates", feature: null, router };
