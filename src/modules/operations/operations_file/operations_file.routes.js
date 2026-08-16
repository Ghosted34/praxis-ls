/** Operations file / dossier (MOD-29). Gated + feature operations. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission, requireLifecyclePermissionOnPatch } = require("../../../shared/http/transition-permission");
const controller = require("./operations_file.controller");
const validator = require("./operations_file.validator");
// `validateX` naming so scripts/check-write-route-validators.js can see it —
// see the note in service_type.routes.js.
const { replace: validateContainerLines } = require("../dossier_container/dossier_container.validator");
const { replace: validateItinerary } = require("../itinerary/itinerary.validator");
const MODULE = "MOD-29";
/**
 * API F-21. This lifecycle was gated by ONE flat permission for every target
 * state, so advancing a record and ending it required the same grant — and an
 * administrator reading the permission matrix could not tell which was which.
 * Advancing is `edit`; a decision that ends the record, or that is irreversible
 * outside the system, is `approve`. Anything not listed falls back to `approve`
 * so a state added later fails closed.
 */
const TRANSITION_ACTION = {
  IN_PROGRESS: "edit",
  COMPLETED: "approve",
  CANCELLED: "approve",
};

const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.get("/:id/360", requirePermission(MODULE, "view"), controller.overview);
router.get("/:id/itinerary", requirePermission(MODULE, "view"), controller.itinerary);
router.put("/:id/itinerary", requirePermission(MODULE, "edit"), validateItinerary, controller.replaceItinerary);
/**
 * The Shared Shipment/Service Detail Component's data — the canonical
 * projection every costing, quotation, proforma, invoice, transit order,
 * delivery note and portal page binds to. One shape for every service type;
 * see shipment_details.rules for how facets are derived.
 */
router.get("/:id/shipment-details", requirePermission(MODULE, "view"), controller.shipmentDetails);
/** A file's equipment. PUT replaces the whole list in one transaction — see
 *  dossier_container.service for why the collection is replaced rather than
 *  patched row by row. */
router.get("/:id/containers", requirePermission(MODULE, "view"), controller.containers);
router.put("/:id/containers", requirePermission(MODULE, "edit"), validateContainerLines, controller.replaceContainers);
router.get("/:id/documents", requirePermission(MODULE, "view"), controller.documents);
/** Give marks & numbers back to the generator after somebody typed over it
 *  (0670). No body — the only thing it can do is clear the override. */
router.post("/:id/marks/revert", requirePermission(MODULE, "edit"), controller.revertMarks);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
/** The creation wizard. `POST /drafts` opens a DRAFT so documents can be
 *  attached before the file is finished; `POST /:id/promote` allocates the ref,
 *  enforces the service type's required fields and fires `dossier.created`.
 *  Both gated on create, because between them they are one creation. */
router.post("/drafts", requirePermission(MODULE, "create"), validator.create, controller.createDraft);
router.post("/:id/promote", requirePermission(MODULE, "create"), validator.promote, controller.promote);
// API F-17: `update: create.partial()` makes the lifecycle field patchable, so
// PATCH was a second, cheaper route to the same state change. It now meets the
// SAME gate as the endpoint above when — and only when — the body carries it.
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update,
  requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }), controller.update);
// Validator FIRST, so the target state is checked against the enum before it
// selects its own gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);
module.exports = { basePath: "/operations", feature: "operations", router };
