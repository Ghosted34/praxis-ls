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

// Filing workflow — persist a computed return and move it DRAFT→COMPUTED→
// APPROVED→FILED. "declarations" is literal so it precedes no dynamic segment here.
router.get("/declarations", requirePermission(MODULE, "view"), controller.listDeclarations);
router.get("/declarations/:id", requirePermission(MODULE, "view"), controller.getDeclaration);
router.post("/declarations", requirePermission(MODULE, "create"), validator.file, controller.fileDeclaration);
router.post("/declarations/:id/approve", requirePermission(MODULE, "approve"), controller.approveDeclaration);
router.post("/declarations/:id/submit", requirePermission(MODULE, "approve"), validator.submit, controller.submitDeclaration);

module.exports = { basePath: "/tax", feature: "accounting.tax", router };
