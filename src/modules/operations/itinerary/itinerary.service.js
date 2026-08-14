"use strict";
const repo = require("./itinerary.repo");
const geoPlace = require("../geo_place/geo_place.service");

async function list(client, dossierId) { return repo.list(client, dossierId); }

async function replace(client, dossierId, legs) {
  // Resolve newly entered free-text locations before writing references. Geoapify
  // is cache-first and best-effort; the text remains usable when a provider miss occurs.
  const wanted = (legs || []).flatMap((l) => [l.origin, l.destination]).filter(Boolean);
  const found = await geoPlace.resolveMany(client, wanted).catch(() => new Map());
  const resolved = (legs || []).map((l) => ({
    ...l,
    origin_place_id: l.origin_place_id || found.get(l.origin)?.geo_place_id || null,
    destination_place_id: l.destination_place_id || found.get(l.destination)?.geo_place_id || null,
  }));
  return repo.replace(client, dossierId, resolved);
}
module.exports = { list, replace, LEG_TYPES: repo.LEG_TYPES, MODES: repo.MODES, STATUSES: repo.STATUSES };
