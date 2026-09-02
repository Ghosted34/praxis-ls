/** Corporate entities (MOD-01). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { mountEntityNested } = require("../_shared/nested");
const controller = require("./corporate_entity.controller");
const validator = require("./corporate_entity.validator");

const MODULE = "MOD-01";
const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
// The dossier the entity page renders. Governance data inside it is redacted per
// caller (entity-360.service.canSeeGovernance), so the route itself stays "view".
router.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
// The cap table is governance data in full — gated at the route, not redacted.
router.get("/:id/cap-table", requirePermission(MODULE, "edit"), controller.capTable);
// Letterhead: the stored configuration plus the rendered preview in both
// languages. The preview runs the same pure function the invoice renderer calls,
// so what the designer shows is what a document prints.
router.get("/:id/letterhead", requirePermission(MODULE, "view"), controller.letterhead);
router.put("/:id/letterhead", requirePermission(MODULE, "edit"), validator.letterhead, controller.saveLetterhead);
/*
 * The tenant's own letterhead lines (12760) — what derivation cannot reach: a
 * strapline, a customs licence, a trade-body membership.
 *
 * MOD-01 `edit`, the same grant as the letterhead itself, because that is what
 * these are: a line on the letterhead. DELETE carries no body, so it skips the
 * validator; the controller reads the verb.
 */
router.post("/:id/letterhead/lines", requirePermission(MODULE, "edit"), validator.letterheadLine, controller.saveLetterheadLine);
router.put("/:id/letterhead/lines/:lineId", requirePermission(MODULE, "edit"), validator.letterheadLine, controller.saveLetterheadLine);
router.delete("/:id/letterhead/lines/:lineId", requirePermission(MODULE, "edit"), controller.saveLetterheadLine);
// Everything on this entity that needs renewing. Advisory: severities stop at
// SOFT_BLOCK_RECOMMENDATION and no rule ever hard-blocks.
// Working calendar — the hours the milestone engine schedules in (0650).
// Nested under the entity because the hours belong to the office that does the
// work, not to the tenant.
router.get("/:id/working-calendar", requirePermission(MODULE, "view"), controller.workingCalendar);
router.put("/:id/working-calendar", requirePermission(MODULE, "edit"), validator.workingCalendar, controller.saveWorkingCalendar);
router.post("/:id/working-calendar/reset", requirePermission(MODULE, "edit"), controller.resetWorkingCalendar);
router.get("/:id/renewals", requirePermission(MODULE, "view"), controller.renewals);

router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);

// Lifecycle. `status` runs the transition table; `active` is the legacy boolean
// kept for the published route and the AI tool, and now routes through it.
router.post("/:id/status", requirePermission(MODULE, "edit"), validator.setStatus, controller.setStatus);
router.post("/:id/active", requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
// Group structure (parent, relationship, ownership, consolidation).
router.post("/:id/structure", requirePermission(MODULE, "edit"), validator.setStructure, controller.setStructure);
// The two characters that lead this entity's OPERATION-file references. Its own
// endpoint rather than a column on PATCH: it is only changeable before the first
// file has used it, and it carries its own audit action.
router.post("/:id/ops-reference-prefix", requirePermission(MODULE, "edit"), validator.opsReferencePrefix, controller.setOpsReferencePrefix);

// Per-entity letterhead logo (light/dark). MOD-01 edit — deliberately not the
// MOD-70-gated /branding/logo, so entity admins don't need settings-admin rights.
router.post("/:id/logo", requirePermission(MODULE, "edit"), validator.logoUpload, controller.uploadLogo);

// Nested collections: people (cap table + officers), contacts, addresses,
// registrations, establishments, documents and tax-registrations under /:id/*.
// No banks — those are treasury_account rows owned by MOD-09 and shown
// read-only on the dossier, which is what keeps the payment block and the GL
// mapping from drifting apart.
mountEntityNested(router, { moduleKey: MODULE, parentTable: "corporate_entity", parentPk: "entity_id" });

module.exports = { basePath: "/entities", feature: null, router };
