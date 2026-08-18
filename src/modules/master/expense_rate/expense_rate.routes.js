/** Expense rate cards (MOD-10). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./expense_rate.controller");
const validator = require("./expense_rate.validator");

const MODULE = "MOD-10";
const router = express.Router();
router.use(authMiddleware);
router.get("/resolve", requirePermission(MODULE, "view"), controller.resolve);
// G7 — bulk Excel import. Declared before "/:id" so "template" is never
// captured as an id, mirroring the financial-dictionary importer.
router.get("/import/template", requirePermission(MODULE, "create"), controller.importTemplate);
router.post("/import/validate", requirePermission(MODULE, "create"), validator.importUpload, controller.importValidate);
router.post("/import/commit", requirePermission(MODULE, "create"), validator.importCommit, controller.importCommit);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/expense-rates", feature: null, router };
