/** Tax Center (MOD-07, PRD §12.4) — TVA return, IS/minimum tax, withholding
 *  return, CNPS declaration (DIPE), DSF dataset. All read-only, gated, GL-derived. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./tax_declaration.controller");
const validator = require("./tax_declaration.validator");

const MODULE = "MOD-07";
const router = express.Router();
router.use(authMiddleware);
router.get("/vat-return", requirePermission(MODULE, "view"), validator.query, controller.vatReturn);
router.get("/corporate-tax", requirePermission(MODULE, "view"), validator.query, controller.corporateTax);
router.get("/withholding-return", requirePermission(MODULE, "view"), validator.query, controller.withholdingReturn);
router.get("/cnps-declaration", requirePermission(MODULE, "view"), validator.query, controller.cnpsDeclaration);
router.get("/dsf-dataset", requirePermission(MODULE, "view"), validator.query, controller.dsfDataset);

module.exports = { basePath: "/tax", feature: "accounting.tax", router };
