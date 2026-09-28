/** Client master (MOD-03). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../../../middleware/rbac");
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

// Who can be named account manager (PR 3, 14200) — the account manager
// picker's search, gated like naming one. Static prefix, before /:id.
router.get("/account-manager-candidates", requireAnyPermission([[MODULE, "edit"], ["MOD-64C", "edit"]]), controller.accountManagerCandidates);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/credit", requirePermission(MODULE, "view"), controller.creditCheck);
// The account manager (PR 3, 14200). Readable by anyone who can see the client
// or answer its messages; set by the client master's editors OR by the people
// who answer the Client inbox (MOD-64C) — sales and operations assign who looks
// after a client, and they do not hold the master's edit right. The two grants
// are equivalent in power for this one field, which is what
// requireAnyPermission asks of its members.
router.get("/:id/account-manager", requireAnyPermission([[MODULE, "view"], ["MOD-64C", "view"]]), controller.accountManager);
router.put("/:id/account-manager", requireAnyPermission([[MODULE, "edit"], ["MOD-64C", "edit"]]), validator.accountManager, controller.setAccountManager);
router.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
router.get("/:id/aging", requirePermission(MODULE, "view"), controller.agingDetail);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);

// Manual hard block (Admin/Manager ~ can_approve), reason required; verify is the
// digital-scan gate (Hard Rule 9).
router.post("/:id/block", requirePermission(MODULE, "approve"), validate(partyCommon.blockReason), controller.block);
router.post("/:id/unblock", requirePermission(MODULE, "approve"), controller.unblock);
router.put("/:id/public-reference-consent", requirePermission(MODULE, "approve"), validator.consent, controller.setPublicReferenceConsent);
router.post("/:id/verify", requirePermission(MODULE, "approve"), controller.verify);

// Governed merge (§5.2) — CEO/Admin (`approve`). In LIVE it opens a maker-checker
// change request; in TEST/sandbox it merges directly. Preview is read-only.
router.post("/:id/merge-preview", requirePermission(MODULE, "view"), validate(partyCommon.mergeRequest), controller.mergePreview);
router.post("/:id/merge", requirePermission(MODULE, "approve"), validate(partyCommon.mergeRequest), controller.merge);
// Copy chosen sections from a converted party's linked origin (§6).
router.post("/:id/copy-from-origin", requirePermission(MODULE, "edit"), validate(partyCommon.cloneFromOrigin), controller.cloneFromOrigin);
// Sensitive-field / merge maker-checker decisions (§8) — a second authorizer.
router.post("/:id/change-requests/:crid/approve", requirePermission(MODULE, "approve"), controller.approveChange);
router.post("/:id/change-requests/:crid/reject", requirePermission(MODULE, "approve"), controller.rejectChange);
// Masked-bank reveal (§3.5) — finance/CEO enforced in the handler; audited.
router.post("/:id/banks/:bankId/reveal", requirePermission(MODULE, "view"), controller.revealBank);

// Nested collections: contacts, addresses, banks, documents, registrations,
// beneficial-owners under /:id/*.
mountNested(router, { kind: "client", moduleKey: MODULE, parentTable: "client_master", parentPk: "client_id" });

module.exports = { basePath: "/clients", feature: null, router };
