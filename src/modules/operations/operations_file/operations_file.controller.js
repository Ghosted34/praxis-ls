"use strict";
const service = require("./operations_file.service");
const details = require("../shipment_details/shipment_details.service");
const containers = require("../dossier_container/dossier_container.service");
const itinerary = require("../itinerary/itinerary.service");
const { maskForUserVia } = require("../../../shared/rbac/field-mask");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  // Body is unchanged ({ data: [...] }); the true match count rides along as
  // X-Total-Count so the screen can page instead of filtering a truncated 50.
  list: asyncHandler(async (req, res) =>
    sendPaged(res, await req.tenantDb((c) => service.listPaged(c, req.query)))),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Operations file not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  // The creation wizard: open a draft, then promote it. See the service.
  createDraft: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createDraft(c, { data: req.body, actor: actor(req) })) })),
  promote: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.promote(c, { id: req.params.id, data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  transition: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: req.body.to, actor: actor(req) })) })),
  // 360° modal is role-gated on money (PRD §7.3/§11.3): Sales/Ops never see margin.
  // Data on the env client; masked field_keys resolved from the identity schema.
  overview: asyncHandler(async (req, res) => res.json({ data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.overview(c, req.params.id))) })),
  itinerary: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => itinerary.list(c, req.params.id)) })),
  replaceItinerary: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => itinerary.replace(c, req.params.id, req.body.legs)) })),
  /**
   * The SSDC projection. `?lang=fr` picks the label language — the field
   * definitions carry both, so a French document and an English one read the
   * same values under different headings without either side reformatting.
   * No money is involved, so no field mask: this is what is being shipped, not
   * what it costs.
   */
  shipmentDetails: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => details.forDossier(c, req.params.id, { lang: req.query.lang })) })),
  containers: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => containers.list(c, req.params.id)) })),
  /** The file's vault documents — what the transit-order checklist previews. */
  documents: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listDocuments(c, req.params.id)) })),
  replaceContainers: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => containers.replace(c, { dossierId: req.params.id, lines: req.body.lines, actor: actor(req) })) })),
  // Undo a manual marks override — see dossier_container.service.revertMarks.
  revertMarks: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => containers.revertMarks(c, { dossierId: req.params.id, actor: actor(req) })) })),
};
