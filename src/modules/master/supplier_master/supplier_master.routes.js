/** Supplier / partner master (MOD-04). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { mountNested, validate } = require("../_shared/nested");
const { partyCommon } = require("@praxis/shared");
const controller = require("./supplier_master.controller");
const validator = require("./supplier_master.validator");

const MODULE = "MOD-04";
const router = express.Router();
router.use(authMiddleware);

// Smart Copy conversion — a client id in, a draft supplier out.
router.post("/convert-from-client/:id", requirePermission(MODULE, "create"), controller.convert);

// Non-blocking duplicate detection (§5.1) — static prefix, before /:id.
router.post("/dedupe-check", requirePermission(MODULE, "view"), validate(partyCommon.dedupeCheck), controller.dedupeCheck);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);

// Manual hard block (reason required); verify doubles as AVL-approval and is the
// digital-scan gate (Hard Rule 9).
router.post("/:id/block", requirePermission(MODULE, "approve"), validate(partyCommon.blockReason), controller.block);
router.post("/:id/unblock", requirePermission(MODULE, "approve"), controller.unblock);
router.post("/:id/verify", requirePermission(MODULE, "approve"), controller.verify);

// Nested collections under /:id/*.
mountNested(router, { kind: "supplier", moduleKey: MODULE, parentTable: "supplier_master", parentPk: "supplier_id" });

module.exports = { basePath: "/suppliers", feature: null, router };
