/** Document verification / QR (MOD-66). /scan is PUBLIC (tenant-resolved, no
 *  login) so a QR can be verified by scanning; /verify is the gated, richer view. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./document_verification.controller");
const validator = require("./document_verification.validator");

const MODULE = "MOD-66";
const router = express.Router();

// Public — no auth. Returns only a tamper verdict + doc type/version.
router.get("/scan", validator.query, controller.scan);

// Everything below requires authentication.
router.use(authMiddleware);
router.get("/verify", requirePermission(MODULE, "view"), validator.query, controller.verify);

module.exports = { basePath: "/document-verification", feature: null, router };
