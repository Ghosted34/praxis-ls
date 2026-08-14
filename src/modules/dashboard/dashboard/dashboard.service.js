/**
 * Control Tower aggregates.
 *
 * The map lane geometry is composed HERE rather than in the repo, because
 * resolving a free-text POL/POD to coordinates can involve an outbound HTTP call
 * (Geoapify, on a cache miss) and doc/CONVENTIONS.md keeps SQL — and only SQL —
 * in the repo. geoapify.service also requires callers to stay outside a DB
 * transaction across that wait, which a service-layer compose makes obvious.
 */
"use strict";
const repo = require("./dashboard.repo");
const geoPlace = require("../../operations/geo_place/geo_place.service");
const { logger } = require("../../../config/logger");

/**
 * Attach `from`/`to` coordinates to each live shipment.
 *
 * Additive and best-effort: a lane whose endpoints can't be resolved keeps every
 * existing field and simply carries `coords: null`, so the shipment list is
 * unaffected and the map just omits that one lane. If the whole resolution fails
 * (0478 unapplied, no Geoapify key, provider down) every lane degrades the same
 * way and the Control Tower still renders.
 */
async function withLaneGeometry(client, shipments) {
  if (!Array.isArray(shipments) || !shipments.length) return shipments;

  // Dossiers that used the port picker (0479) already carry exact coordinates
  // off the FK join — leave those alone. Only the free-text ones need resolving
  // by name, which is the fuzzy path we're trying to move away from.
  const needsResolve = shipments.filter((s) => !s.coords);
  if (!needsResolve.length) return shipments;

  const places = [];
  needsResolve.forEach((s) => {
    if (s.origin) places.push(s.origin);
    if (s.destination) places.push(s.destination);
  });
  if (!places.length) return shipments;

  let resolved = new Map();
  try {
    resolved = await geoPlace.resolveMany(client, places);
  } catch (err) {
    logger.warn({ err }, "[control-tower] lane geometry unavailable");
    return shipments.map((s) => ({ ...s, coords: null }));
  }

  return shipments.map((s) => {
    if (s.coords) return s; // already exact, off the picker's FK
    const from = s.origin ? resolved.get(s.origin) || null : null;
    const to = s.destination ? resolved.get(s.destination) || null : null;
    return {
      ...s,
      // Both ends required — a single plotted point isn't a lane, and half a
      // route drawn to nowhere is exactly the kind of thing the old hardcoded
      // map did. Callers can still read origin/destination as text.
      coords: from && to ? { from, to } : null,
    };
  });
}

module.exports = {
  kpis: (client) => repo.kpis(client),
  async controlTower(client, options = {}) {
    const base = await repo.controlTower(client, options);
    return { ...base, live_shipments: await withLaneGeometry(client, base.live_shipments) };
  },
};
