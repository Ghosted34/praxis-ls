"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./geo_place.service");

module.exports = {
  /** GET /geo-places?q= — powers the POL/POD pickers on the dossier form. */
  list: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) =>
      service.list(c, { q: req.query.q || null, limit: Math.min(Number(req.query.limit) || 50, 200) }),
    );
    res.json({ data });
  }),

  /**
   * POST /geo-places — add a port the seed didn't cover.
   *
   * The picker already falls back to free text plus on-demand geocoding, so this
   * is for the case where the geocoder gets it wrong or doesn't know the place
   * at all (a private terminal, an inland dry port). Recorded as MANUAL, which
   * resolveMany treats as authoritative — a later geocode will not overwrite it.
   */
  create: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.createManual(c, { ...req.body, actor: req.user }));
    res.status(201).json({ data });
  }),
};
