/** Tax Jurisdiction + tax codes (MOD-07). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./tax_jurisdiction.controller");
const validator = require("./tax_jurisdiction.validator");

const MODULE = "MOD-07";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/codes", requirePermission(MODULE, "view"), controller.listCodes);
router.get("/:id/effective", requirePermission(MODULE, "view"), controller.effective);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/active", requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
router.post("/:id/codes", requirePermission(MODULE, "create"), validator.addCode, controller.addCode);
// Amend a rate (Finance-Law change): atomic expire-current + open-new. Edits an
// existing window, so it takes the "edit" grant rather than plain "create".
router.post("/:id/codes/supersede", requirePermission(MODULE, "edit"), validator.supersede, controller.supersede);

module.exports = { basePath: "/tax-jurisdictions", feature: null, router };
