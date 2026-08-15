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
const itinerary = require("../../operations/itinerary/itinerary.service");
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

  // Dossiers that used the place picker already carry exact coordinates off the
  // FK join — leave those alone. So does a file whose itinerary has a plottable
  // leg: it has real geometry, and resolving its parent lane by name would spend
  // a fuzzy lookup to draw a line the legs already describe better.
  const needsResolve = shipments.filter(
    (s) => !s.coords && !(Array.isArray(s.legs) && s.legs.some((l) => l.plottable)),
  );
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

/**
 * Attach each file's structured itinerary.
 *
 * WHY THE MAP NEEDS THIS AND NOT JUST pol/pod. A dossier's POL and POD describe
 * the main carriage and nothing else, so an end-to-end file had two of its six
 * movements recorded anywhere — and the tower drew one line between two ports
 * while the operator was being chased about the truck that had not collected yet.
 * With legs, the same file draws pickup, sail, customs, inland and delivery, each
 * in its own mode's colour.
 *
 * ONE QUERY for the whole page (see `itinerary.forDossiers`), not one per file.
 * Additive and best-effort: a tenant whose 0672 table is missing, or a file with
 * no legs, keeps every existing field and carries `legs: []`, so the tower falls
 * back to the parent POL→POD lane exactly as before.
 */
async function withItineraries(client, shipments) {
  if (!Array.isArray(shipments) || !shipments.length) return shipments;
  const ids = shipments.map((s) => s.dossier_id).filter(Boolean);
  if (!ids.length) return shipments.map((s) => ({ ...s, legs: [] }));

  let byDossier = new Map();
  try {
    byDossier = await itinerary.forDossiers(client, ids);
  } catch (err) {
    logger.warn({ err }, "[control-tower] itinerary legs unavailable");
    return shipments.map((s) => ({ ...s, legs: [] }));
  }
  return shipments.map((s) => ({ ...s, legs: byDossier.get(s.dossier_id) || [] }));
}

module.exports = {
  kpis: (client) => repo.kpis(client),
  async controlTower(client, options = {}) {
    const base = await repo.controlTower(client, options);
    // Order matters: the legs are attached first so `withLaneGeometry` can see
    // that a file already has plottable geometry and skip resolving its parent
    // lane by name — which is the only remaining path that can reach Geoapify
    // from a dashboard load.
    const withLegs = await withItineraries(client, base.live_shipments);
    return { ...base, live_shipments: await withLaneGeometry(client, withLegs) };
  },
};
