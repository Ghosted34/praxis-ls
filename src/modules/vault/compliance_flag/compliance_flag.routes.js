/** Compliance Checker (MOD-65). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./compliance_flag.controller");
const validator = require("./compliance_flag.validator");

const MODULE = "MOD-65";
const router = express.Router();
router.use(authMiddleware);
router.get("/catalogue", requirePermission(MODULE, "view"), controller.catalogue);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/run", requirePermission(MODULE, "edit"), validator.run, controller.run);
router.post("/:id/resolve", requirePermission(MODULE, "edit"), controller.resolve);

module.exports = { basePath: "/compliance", feature: null, router };
