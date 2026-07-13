/** Document vault (MOD-64) — auth-gated reads + confidential download (not the
 *  public /media mount). SQL in the repo; gated per CONVENTIONS. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./document_vault.controller");
const validator = require("./document_vault.validator");

const MODULE = "MOD-64";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/download", requirePermission(MODULE, "view"), controller.download);
// Writes: upload a document (base64) and soft-delete (archive).
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/documents", feature: null, router };
