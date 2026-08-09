/** Financial Dictionary (MOD-05) — dictionary items + their OHADA posting rules
 *  + service-type tiers + the seeded-editable dropdown registry (dictionary_ref).
 *  The account-determination source of truth (KB §4). Gated: auth + RBAC MOD-05. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const c = require("./financial_dictionary.controller");
const v = require("./financial_dictionary.validator");

const MODULE = "MOD-05";
const router = express.Router();
router.use(authMiddleware);

// Registry (dropdown values) — declared before "/:id" so "refs" is not read as an id.
router.get("/refs", requirePermission(MODULE, "view"), c.listRefs);
router.post("/refs", requirePermission(MODULE, "create"), v.refCreate, c.createRef);
router.patch("/refs/:id", requirePermission(MODULE, "edit"), v.refUpdate, c.updateRef);

router.get("/", requirePermission(MODULE, "view"), c.list);
router.get("/:id/360", requirePermission(MODULE, "view"), c.dossier);
router.get("/:id", requirePermission(MODULE, "view"), c.get);
router.post("/", requirePermission(MODULE, "create"), v.create, c.create);
router.patch("/:id", requirePermission(MODULE, "edit"), v.update, c.update);

module.exports = { basePath: "/financial-dictionary", feature: null, router };
