/**
 * Place resolution for the shipment map: free-text place → coordinates.
 *
 * CACHE FIRST, GEOCODE ONCE. `geo_place` (0478) is seeded with the ports already
 * in use; anything unseen is forward-geocoded via Geoapify exactly once and
 * written back. The map therefore never geocodes on render, and the free tier
 * (3,000/day) is spent per NEW place rather than per page load.
 *
 * NEVER THROWS. An unresolvable place yields null and the caller omits that lane
 * — a map that can't plot Tema must still plot the other four. Same contract the
 * geoapify service itself follows.
 *
 * TRANSACTION NOTE. geoapify.service documents that callers must not hold a DB
 * transaction across its HTTP wait. `resolveMany` honours that: it reads the
 * cache, RELEASES, geocodes over HTTP, then writes back. Callers must pass a
 * plain pooled client, not one mid-BEGIN.
 */
"use strict";

const repo = require("./geo_place.repo");
const events = require("./geo_place.events");
const geoapify = require("../../../services/geoapify.service");
const { audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

/**
 * Bias unresolved lookups toward the Gulf of Guinea. Without it a bare "Kribi"
 * or "Garoua" can resolve to a same-named place on another continent — the
 * classic forward-geocoding failure. "lon,lat" per Geoapify's proximity format.
 */
const DEFAULT_BIAS = "9.70,4.05"; // Douala

/**
 * Resolve a list of free-text place names to coordinates.
 * Returns a Map keyed by the ORIGINAL string (not the normalised key), so
 * callers can look up with whatever the dossier held.
 */
async function resolveMany(client, places, { geocodeMisses = true } = {}) {
  const out = new Map();
  const wanted = [...new Set((places || []).map((p) => String(p || "").trim()).filter(Boolean))];
  if (!wanted.length) return out;

  const keyOf = new Map(wanted.map((p) => [p, repo.normalise(p)]));
  const keys = [...new Set([...keyOf.values()])].filter(Boolean);

  let cached = [];
  try {
    cached = await repo.findByKeys(client, keys);
  } catch (err) {
    // Table missing (migration 0478 not applied) → degrade to no coordinates
    // rather than 500ing the whole dashboard.
    logger.warn({ err }, "[geo_place] cache read failed");
    return out;
  }
  const byKey = new Map(cached.map((r) => [r.query_key, r]));

  const misses = keys.filter((k) => !byKey.has(k));
  if (geocodeMisses && misses.length) {
    // Sequential on purpose: misses are rare (a genuinely new port), and a burst
    // of parallel requests is the fastest way to trip a free-tier rate limit.
    for (const key of misses) {
      const original = wanted.find((p) => keyOf.get(p) === key) || key;
       
      const hit = await geoapify.forwardGeocode(original, { bias: DEFAULT_BIAS });
      if (!hit) continue;
      try {
         
        const row = await repo.upsert(client, {
          queryKey: key,
          name: original,
          country: hit.country,
          kind: "OTHER",
          latitude: hit.latitude,
          longitude: hit.longitude,
          source: "GEOAPIFY",
          formatted: hit.formatted,
        });
        if (row) {
          byKey.set(key, row);
        } else {
          // upsert is ON CONFLICT DO NOTHING, so a null return means another
          // request inserted the same place first. Re-read rather than
          // synthesising a row — we need the real geo_place_id, and the winning
          // row may be a MANUAL correction whose coordinates differ from ours.
           
          const [existing] = await repo.findByKeys(client, [key]);
          if (existing) byKey.set(key, existing);
        }
      } catch (err) {
        logger.warn({ err, place: original }, "[geo_place] cache write failed");
      }
    }
  }

  for (const original of wanted) {
    const row = byKey.get(keyOf.get(original));
    if (!row) continue;
    out.set(original, {
      geo_place_id: row.geo_place_id || null,
      name: row.name,
      country: row.country || null,
      // numeric(9,6) comes back from pg as a string — coerce, or the FE does
      // arithmetic on "4.048200" and silently produces NaN in the projection.
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      source: row.source,
    });
  }
  return out;
}

const list = (client, q) => repo.list(client, q);

/**
 * Add a place by hand. Forced to source='MANUAL' regardless of what the caller
 * says — resolveMany treats MANUAL as a human correction that a later geocode
 * must not overwrite, so letting a client claim that provenance would let a bad
 * value pin itself permanently.
 */
async function createManual(client, { name, latitude, longitude, country, kind, actor = {} }) {
  const row = await repo.upsert(client, {
    queryKey: repo.normalise(name),
    name,
    country: country ? String(country).toUpperCase() : null,
    kind: kind || "OTHER",
    latitude,
    longitude,
    source: "MANUAL",
    formatted: null,
  });
  // upsert is ON CONFLICT DO NOTHING, so a null return means the place already
  // existed. Report the existing row rather than failing — the caller wanted a
  // usable place and there is one.
  if (row) {
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: "geo_place:" + row.geo_place_id,
      after: row,
    });
    return row;
  }
  const existing = await repo.findByKeys(client, [repo.normalise(name)]);
  return existing[0] || null;
}

module.exports = { resolveMany, list, createManual, normalise: repo.normalise };
