"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./geo_place.service");

module.exports = {
  /** GET /geo-places?q= — the legacy list, kept for `SearchSelect` callers. */
  list: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) =>
      service.list(c, { q: req.query.q || null, limit: Math.min(Number(req.query.limit) || 50, 200) }),
    );
    res.json({ data });
  }),

  /**
   * GET /geo-places/search — the place picker's endpoint.
   *
   * Returns the catalogue matches AND, only when `provider=true` was asked for
   * and the catalogue had no exact answer, the provider's candidates with a
   * typed status. Two lists rather than one merged list, deliberately: a
   * catalogue row is something the operator can pick and use immediately, a
   * provider candidate is something they must confirm first, and blurring the
   * two is how an unverified place ends up on a file.
   */
  search: asyncHandler(async (req, res) => {
    const { q = null, country = null, kind = null, limit, provider } = req.query;
    const data = await req.tenantDb((c) =>
      service.search(c, { q, country, kinds: kind || null, limit, provider: provider === true }),
    );
    res.json({ data });
  }),

  /**
   * POST /geo-places/confirm — cache a provider suggestion the operator picked.
   *
   * Separate from POST /geo-places because the two say different things about
   * where a coordinate came from, and `source` is load-bearing: MANUAL rows are
   * protected from later geocodes, GEOAPIFY rows are not. One endpoint taking a
   * `source` parameter would let the caller choose that protection.
   */
  confirm: asyncHandler(async (req, res) => {
    const { query: q, provider_place_id: providerPlaceId, country, kind, is_reference_point: isReferencePoint } = req.body;
    const data = await req.tenantDb((c) =>
      service.confirmSuggestion(c, {
        query: q,
        providerPlaceId,
        country: country || null,
        kind: kind || null,
        isReferencePoint: isReferencePoint === true,
        actor: req.user,
      }),
    );
    res.status(201).json({ data });
  }),

  /**
   * POST /geo-places — add a place the catalogue and the provider both miss.
   *
   * The last resort, and a necessary one: a private terminal, a bonded warehouse
   * behind a gate, a customer whose address no geocoder knows. Recorded as
   * MANUAL, which `resolveMany` treats as authoritative — a later geocode will
   * not overwrite it.
   */
  create: asyncHandler(async (req, res) => {
    const { is_reference_point: isReferencePoint, ...rest } = req.body;
    const data = await req.tenantDb((c) =>
      service.createManual(c, { ...rest, isReferencePoint: isReferencePoint === true, actor: req.user }),
    );
    res.status(201).json({ data });
  }),
};
