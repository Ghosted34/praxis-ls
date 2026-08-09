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
const validator = require("./service_type.validator");
const dossier360 = require("./service_type_360.service");
const { MODULE } = require("./service_type.events");

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
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/service-types", feature: "operations", router };
