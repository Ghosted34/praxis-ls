/** Statements (MOD-59) — trial balance, Compte de résultat, Bilan, Notes,
 *  guided monthly close. Read-only except the close. Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./financial_statement.controller");
const validator = require("./financial_statement.validator");

const MODULE = "MOD-59";
const router = express.Router();
router.use(authMiddleware);
router.get("/trial-balance", requirePermission(MODULE, "view"), validator.query, controller.trialBalance);
router.get("/income-statement", requirePermission(MODULE, "view"), validator.query, controller.compteDeResultat);
router.get("/balance-sheet", requirePermission(MODULE, "view"), validator.query, controller.bilan);
router.get("/grand-livre", requirePermission(MODULE, "view"), validator.query, controller.grandLivre);
router.get("/cash-flow", requirePermission(MODULE, "view"), validator.query, controller.cashFlow);
router.get("/notes", requirePermission(MODULE, "view"), validator.query, controller.notes);
// Guided monthly close (KB §12): list periods + freeze/close (edit permission).
router.get("/periods", requirePermission(MODULE, "view"), validator.query, controller.listPeriods);
router.post("/periods/close", requirePermission(MODULE, "edit"), validator.closePeriod, controller.closePeriod);

module.exports = { basePath: "/statements", feature: "accounting.statements", router };
