/** Client master (MOD-03). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { mountNested, validate } = require("../_shared/nested");
const { partyCommon } = require("@praxis/shared");
const controller = require("./client_master.controller");
const validator = require("./client_master.validator");

const MODULE = "MOD-03";
const router = express.Router();
router.use(authMiddleware);

// Smart Copy conversion — a supplier id in, a draft client out. Registered
// before the /:id family; its static prefix keeps it unambiguous either way.
router.post("/convert-from-supplier/:id", requirePermission(MODULE, "create"), controller.convert);

// Non-blocking duplicate detection (§5.1) — static prefix, before /:id.
router.post("/dedupe-check", requirePermission(MODULE, "view"), validate(partyCommon.dedupeCheck), controller.dedupeCheck);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/credit", requirePermission(MODULE, "view"), controller.creditCheck);
router.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);

// Manual hard block (Admin/Manager ~ can_approve), reason required; verify is the
// digital-scan gate (Hard Rule 9).
router.post("/:id/block", requirePermission(MODULE, "approve"), validate(partyCommon.blockReason), controller.block);
router.post("/:id/unblock", requirePermission(MODULE, "approve"), controller.unblock);
router.post("/:id/verify", requirePermission(MODULE, "approve"), controller.verify);

// Nested collections: contacts, addresses, banks, documents, registrations,
// beneficial-owners under /:id/*.
mountNested(router, { kind: "client", moduleKey: MODULE, parentTable: "client_master", parentPk: "client_id" });

module.exports = { basePath: "/clients", feature: null, router };
