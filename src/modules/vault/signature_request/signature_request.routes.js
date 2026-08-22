/**
 * Signature requests (MOD-64). Gated; feature 'signatures.external'.
 *
 * RBAC maps onto the tenant's fixed five-action vocabulary (0110_rbac.sql):
 *   view   — see requests and their chains
 *   create — create a request and dispatch it
 *   edit   — add the ONE manually-entered signatory (§6.3)
 *   delete — void a request
 *
 * `create` and `approve` stay separate for the reason document_signature.routes
 * already records: drafting a document for signature and attesting to it are
 * different authorities. Putting your own name on a document takes `approve`
 * and lives on /signatures; ASKING somebody else to takes `create` and lives
 * here.
 *
 * The whole module is behind `signatures.external` rather than `signatures`,
 * so a tenant that has the portal (PR-2) but has not been switched on for
 * external signing gets a clean 403 rather than a half-working chain.
 */
"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./signature_request.controller");
const validator = require("./signature_request.validator");

const MODULE = "MOD-64";
const router = express.Router();

router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), validator.listQuery, controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);

router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.post("/:id/dispatch", requirePermission(MODULE, "create"), validator.dispatchBody, controller.dispatch);
router.post("/:id/void", requirePermission(MODULE, "delete"), validator.voidRequest, controller.void);
/*
 * The Certificate of Completion. `view`, not `create`: issuing it is
 * idempotent and generates nothing new for a chain that already has one, so
 * the authority it needs is the authority to READ the chain. Gating it on
 * `create` would mean the person who has to hand the evidence to a lawyer
 * needs permission to start new signature requests.
 */
router.post("/:id/certificate", requirePermission(MODULE, "view"), validator.dispatchBody, controller.certificate);

module.exports = { basePath: "/signature-requests", feature: "signatures.external", router };
