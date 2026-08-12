/**
 * Service taxonomy (MOD-29 — see service_type.events.js for why it rides the
 * dossier's module key). Feature-gated on `operations`.
 *
 * Hand-rolled rather than makeRouter() so DELETE maps to the service's archive
 * (deactivate) rather than the kit's soft-delete: `dossier.service_type_id` is a
 * plain FK, so a real delete would either fail the constraint or strip the
 * classification off historical dossiers.
 */
"use strict";
const express = require("express");
const { asyncHandler } = require("../../../utils/errors");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./service_type.controller");
const service = require("./service_type.service");
const validator = require("./service_type.validator");
const dossier360 = require("./service_type_360.service");
const { MODULE } = require("./service_type.events");
// The shipment/service-detail form lives on the service type, so its routes
// hang off this router rather than claiming a second basePath — `/service-types
// /:id/field-sets` reads as what it is, and the module loader mounts one router
// per basePath. Same arrangement as `/:id/dictionary/:itemId` below.
const fieldService = require("../service_type_field/service_type_field.service");
// Bound to `validateX` names rather than `fieldValidator.x`: this router already
// has a `validator`, and scripts/check-write-route-validators.js recognises a
// validator in a handler chain by that naming (it is the same shape
// preference.routes.js uses). A validator the guard cannot see is a validator
// the next person will assume is missing.
const {
  createVersion: validateCreateVersion,
  createField: validateCreateField,
  updateField: validateUpdateField,
  containers: validateContainerCapture,
  publish: validatePublishBody,
} = require("../service_type_field/service_type_field.validator");
const details = require("../shipment_details/shipment_details.service");

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
// The 360° rollup: dossiers/templates/dictionary/margin sims/money — money keys
// arrive nulled for callers without finance visibility (MOD-09 read), same rule
// the party masters use. Gated MOD-29 view like the base record.
router.get(
  "/:id/360",
  requirePermission(MODULE, "view"),
  asyncHandler(async (req, res) => {
    const canSee = await dossier360.canSeeFinancials(req);
    const data = await req.tenantDb((c) => dossier360.dossier(c, req.params.id, { canSeeFinancials: canSee }));
    res.json({ data });
  }),
);
/**
 * The tier matrix (ST-360 → Dictionary). PUT is an upsert: setting a tier on a
 * line that is not yet scoped to this service ADDS it, which is what "add a
 * line at Basic" means from the UI's point of view — one verb, not a create and
 * an update the caller has to choose between.
 *
 * Declared before "/:id" is irrelevant here (the path is longer and more
 * specific), but it is gated `edit` rather than `view`: which lines a service
 * pulls, and at which bundle, changes what every future costing of that type
 * loads.
 */
router.put(
  "/:id/dictionary/:itemId",
  requirePermission(MODULE, "edit"),
  validator.dictionaryTier,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.setDictionaryTier(c, {
      id: req.params.id,
      dictionaryItemId: req.params.itemId,
      tier: req.body.tier,
      actor: req.user || {},
    }));
    res.json({ data });
  }),
);
router.delete(
  "/:id/dictionary/:itemId",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.removeDictionaryTier(c, {
      id: req.params.id,
      dictionaryItemId: req.params.itemId,
      actor: req.user || {},
    }));
    res.json({ data });
  }),
);

/* ── Shipment/service detail form (SSDC config) ────────────────────────────── */

/**
 * The form this service type asks for, in every version. Declared before
 * "/:id" purely for readability — Express matches on the longer, more specific
 * pattern regardless.
 *
 * Gated `view`: knowing which fields a service captures is part of reading the
 * service type. Every WRITE below is `edit`, because changing the form changes
 * what every future file of this type records and what every document prints.
 */
router.get(
  "/:id/field-sets",
  requirePermission(MODULE, "view"),
  asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => fieldService.list(c, req.params.id)) });
  }),
);
router.get(
  "/:id/field-sets/:setId",
  requirePermission(MODULE, "view"),
  asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => fieldService.get(c, req.params.id, req.params.setId)) });
  }),
);
/**
 * The blank form for CREATING a file of this service type — definitions, no
 * values. This is the endpoint the operations-file screen calls the moment a
 * service type is picked, which is the behaviour this whole feature exists for:
 * choose the service, and the fields to fill appear.
 */
router.get(
  "/:id/detail-form",
  requirePermission(MODULE, "view"),
  asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => details.formFor(c, req.params.id, { lang: req.query.lang })) });
  }),
);
/** Start a new draft version — by default a clone of the live one, which is
 *  what "edit the form" means (a published version is never mutated). */
router.post(
  "/:id/field-sets",
  requirePermission(MODULE, "edit"),
  validateCreateVersion,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => fieldService.createVersion(c, {
      serviceTypeId: req.params.id, from: req.body.from, name: req.body.name, actor: req.user || {},
    }));
    res.status(201).json({ data });
  }),
);
/** Publish a draft: every NEW file of this type is created against it. Files
 *  already open keep the version they were created under. */
router.post(
  "/:id/field-sets/:setId/publish",
  requirePermission(MODULE, "edit"),
  validatePublishBody,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => fieldService.publish(c, {
      serviceTypeId: req.params.id, fieldSetId: req.params.setId, actor: req.user || {},
    }));
    res.json({ data });
  }),
);
router.post(
  "/:id/field-sets/:setId/fields",
  requirePermission(MODULE, "edit"),
  validateCreateField,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => fieldService.addField(c, {
      serviceTypeId: req.params.id, fieldSetId: req.params.setId, data: req.body, actor: req.user || {},
    }));
    res.status(201).json({ data });
  }),
);
router.patch(
  "/:id/field-sets/:setId/fields/:fieldId",
  requirePermission(MODULE, "edit"),
  validateUpdateField,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => fieldService.updateField(c, {
      serviceTypeId: req.params.id, fieldSetId: req.params.setId, fieldId: req.params.fieldId,
      patch: req.body, actor: req.user || {},
    }));
    res.json({ data });
  }),
);
/** Removes a tenant's own field; DEACTIVATES one we shipped (Q9 governance —
 *  see the service header). Values already captured are never destroyed. */
router.delete(
  "/:id/field-sets/:setId/fields/:fieldId",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => fieldService.removeField(c, {
      serviceTypeId: req.params.id, fieldSetId: req.params.setId, fieldId: req.params.fieldId, actor: req.user || {},
    }));
    res.json({ data });
  }),
);
/** Equipment capture: whether files of this type carry containers at all, and
 *  whether they are counted by type or identified box by box. */
router.put(
  "/:id/containers",
  requirePermission(MODULE, "edit"),
  validateContainerCapture,
  asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => fieldService.configureContainers(c, {
      serviceTypeId: req.params.id,
      capturesContainers: req.body.captures_containers,
      detailMode: req.body.container_detail_mode,
      actor: req.user || {},
    }));
    res.json({ data });
  }),
);

router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/service-types", feature: "operations", router };
