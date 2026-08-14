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
//
// `/search` is declared before nothing that could shadow it (there is no
// `/:id` route on this module), but it stays above the bare `/` for the same
// reason it always should: the literal path must never be reachable only by
// accident of ordering.
router.get("/search", requirePermission(MODULE, "view"), validator.search, controller.search);
router.get("/", requirePermission(MODULE, "view"), controller.list);
// Confirming a provider suggestion writes a row every future file can pick, so
// it is gated the same as creating one by hand. The difference between the two
// endpoints is provenance, not privilege.
router.post("/confirm", requirePermission(MODULE, "create"), validator.confirm, controller.confirm);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);

module.exports = { basePath: "/geo-places", feature: "operations", router };
