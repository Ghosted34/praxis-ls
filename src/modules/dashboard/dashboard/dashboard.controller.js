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

  // The enumeration lives in the service (`controlTowerOptions`) so the AI
  // manifest runs the same one — an unrecognised mode/layer/date field means
  // "no filter" on both paths, not just this one.
  controlTower: asyncHandler(async (req, res) => {
    const options = service.controlTowerOptions(req.query || {});
    res.json({ data: await req.tenantDb((c) => service.controlTower(c, options)) });
  }),
};
