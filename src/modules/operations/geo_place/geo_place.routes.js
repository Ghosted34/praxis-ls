/**
 * Port / place reference data (rides MOD-29 — see geo_place.events.js for why).
 * Feature-gated on `operations`, like the dossier it serves.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./geo_place.controller");
const validator = require("./geo_place.validator");
const { MODULE } = require("./geo_place.events");

const router = express.Router();
router.use(authMiddleware);

// Read is bound to dossier "view": anyone who can see a dossier can look up the
// ports it routes through. Write needs "create" — adding reference data that
// every future dossier and the Control Tower map will inherit.
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);

module.exports = { basePath: "/geo-places", feature: "operations", router };
