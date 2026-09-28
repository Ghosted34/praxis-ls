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
const RATES_MODULE = "MOD-10";
const router = express.Router();
router.use(authMiddleware);

// Registry (dropdown values) — declared before "/:id" so "refs" is not read as an id.
router.get("/refs", requirePermission(MODULE, "view"), c.listRefs);
router.post("/refs", requirePermission(MODULE, "create"), v.refCreate, c.createRef);
router.patch("/refs/:id", requirePermission(MODULE, "edit"), v.refUpdate, c.updateRef);

// Bulk import — declared before "/:id" for the same reason as "refs": a literal
// segment must not be read as an id.
router.get("/import/template", requirePermission(MODULE, "create"), c.importTemplate);
router.post("/import/validate", requirePermission(MODULE, "create"), v.importUpload, c.importValidate);
router.post("/import/commit", requirePermission(MODULE, "create"), v.importCommit, c.importCommit);
router.post("/import/errors", requirePermission(MODULE, "view"), v.importErrors, c.importErrors);

// The shared finder, before "/:id" for the same reason as "refs": a literal
// segment must not be read as an id. Only needs `view` — it is the read path
// every other module's picker calls.
router.get("/search", requirePermission(MODULE, "view"), v.searchQuery, c.search);

router.get("/", requirePermission(MODULE, "view"), c.list);
router.get("/:id/360", requirePermission(MODULE, "view"), c.dossier);
router.get("/:id/spend", requirePermission(MODULE, "view"), v.spendQuery, c.spend);
// The documents behind the Spend tab's tiles, a page at a time — the rows the
// tab's own list already shows on MOD-05, so the same gate.
router.get("/:id/spend/documents", requirePermission(MODULE, "view"), v.spendDocsQuery, c.spendDocuments);
// The rows behind the 360's usage tiles, one page at a time. MOD-05 view opens
// the route; each DOCUMENT list is then gated on the module that owns its rows
// (see the controller), because the rows name clients and amounts the counts
// do not.
router.get("/:id/usage/:kind", requirePermission(MODULE, "view"), v.usageQuery, c.usage);
router.get("/:id/rate-history", requirePermission(MODULE, "view"), c.rateEvolution);
// Rates are EXPENSE-RATE writes, so they are gated on MOD-10 (Expense rates),
// not on the dictionary: someone who may edit catalogue wording must not be
// able to change what a line costs (meeting 5, 01:17:37). The dictionary's
// own "Edit standard rate" pop-up posts here too, so it inherits the gate.
router.post("/:id/rates/supersede", requirePermission(RATES_MODULE, "edit"), v.rateSupersede, c.supersedeRate);
router.post("/:id/rates/apply-all", requirePermission(RATES_MODULE, "edit"), v.rateApplyAll, c.applyRateToProviders);
router.get("/:id", requirePermission(MODULE, "view"), c.get);
router.post("/", requirePermission(MODULE, "create"), v.create, c.create);
router.patch("/:id", requirePermission(MODULE, "edit"), v.update, c.update);

module.exports = { basePath: "/financial-dictionary", feature: null, router };
