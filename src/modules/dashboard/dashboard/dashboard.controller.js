"use strict";
const service = require("./dashboard.service");
const { asyncHandler } = require("../../../utils/errors");

/**
 * The identity half of a band read, gathered once against the live schema.
 *
 * Kept out of the service because only a request has BOTH handles: this reads
 * pins, role configs and grants (identity — env-pinned), and the tenant half
 * reads business values. The two awaits are SEQUENTIAL on purpose: they share
 * one leased connection (tenant-context.js, PERF S2), and `pg` serialises
 * whatever runs on it — `Promise.all` across the two envs would interleave
 * search_path switches in one connection, which is the nesting bug the pin
 * restore in `withPinned` exists to defuse. Sequential calls make the order a
 * fact of the code rather than of the pool.
 */
async function readBandIdentity(req) {
  return req.identityDb((c) => service.bandIdentity(c, req.user));
}

module.exports = {
  kpis: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.kpis(c)) })),

  /**
   * Legacy headline KPIs + the resolved band, one payload. The MOD-00A gate on
   * the route is also the band's own gate (an `approvals`/`needs_location`
   * tile checks it again through eligibility — belt AND braces, since the tile
   * list escapes into the picker response).
   */
  kpisWithBand: asyncHandler(async (req, res) => {
    const identity = await readBandIdentity(req);
    const data = await req.tenantDb((c) => service.kpiBand(c, identity));
    res.json({ data });
  }),

  /** The picker's view: what this caller may choose, what their roles pin. */
  kpiCatalog: asyncHandler(async (req, res) => {
    const identity = await readBandIdentity(req);
    const data = await req.tenantDb((c) => service.kpiCatalogPayload(c, identity));
    res.json({ data });
  }),

  controlTower: asyncHandler(async (req, res) => {
    const q = req.query || {};
    const limit = Math.max(1, Math.min(Number(q.limit) || 50, 100));
    const allowed = new Set(["created", "updated", "arrival", "delivery"]);
    // Enumerated rather than passed through: both go into a SQL predicate, and an
    // unrecognised value must mean "no filter" rather than reaching the repo.
    const modes = new Set(["AIR", "SEA", "LAND", "RAIL", "OTHER"]);
    const layers = new Set(["MOVEMENT", "ACTIVITY"]);
    const verifications = new Set(["VERIFIED", "UNVERIFIED"]);
    const pick = (value, set) => {
      const v = value ? String(value).toUpperCase() : null;
      return v && set.has(v) ? v : null;
    };
    const options = {
      limit, cursor: q.cursor || null, serviceTypeId: q.service_type_id || null,
      territory: q.territory || null,
      mode: pick(q.mode, modes),
      layer: pick(q.layer, layers),
      verified: pick(q.verified, verifications),
      dateField: allowed.has(q.date_field) ? q.date_field : "created",
      from: q.from || null, to: q.to || null, includeCompleted: q.include_completed === "true",
    };
    res.json({ data: await req.tenantDb((c) => service.controlTower(c, options)) });
  }),
};
