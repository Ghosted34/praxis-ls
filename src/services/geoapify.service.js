/**
 * Geoapify reverse geocoding (HR clock-in location labels).
 *
 * Turns the coordinates captured at clock-in into a human address ONCE, at
 * punch time, server-side. The UI never geocodes on render — it displays the
 * stored label and links the stored coordinates to a map.
 *
 * Best-effort BY DESIGN: returns null on a missing key, bad coords, timeout
 * or any upstream error — it must never throw, so a slow or down Geoapify
 * can't break clock-in. Callers must invoke it OUTSIDE any DB transaction so
 * the HTTP wait never holds a connection open.
 *
 * Key resolution (DEPLOY-WIDE): platform_setting 'geocoding'/'geoapify' (set +
 * tested in the Platform Console) → env GEOAPIFY_API_KEY. Blank = coords + map
 * pin still work, no label. Free tier is 3,000 requests/day — ample for clock-ins.
 */

"use strict";

const axios = require("axios");
const { logger } = require("../config/logger");

const REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
const SEARCH_URL = "https://api.geoapify.com/v1/geocode/search";
const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const TIMEOUT_MS = 3000;
/** Autocomplete is interactive but ranks more candidates, so it gets longer than
 *  the fire-and-forget calls above — and still short enough that a stalled
 *  provider surfaces as a visible timeout rather than a hung picker. */
const SEARCH_TIMEOUT_MS = 4500;
/** Below this, autocomplete returns noise and we would spend quota on it. */
const MIN_QUERY_CHARS = 3;
/** Hard ceiling on what a caller may ask the provider for, per request. */
const MAX_RESULTS = 10;

let _key; // undefined = unresolved; null/string = resolved
function resetCache() { _key = undefined; }

/**
 * A loggable description of an upstream failure — and NOTHING ELSE.
 *
 * `logger.warn({ err })` on an axios error serialises `err.config`, and
 * `err.config.params` is the object this module puts `apiKey` into. So the
 * obvious log line writes the deploy-wide Geoapify secret into the log stream on
 * every provider hiccup, where it is retained, shipped and searchable. That is
 * the leak this helper exists to prevent: callers log THIS, never the error.
 */
function describeError(err) {
  return {
    // ECONNABORTED is what axios reports for its own timeout.
    code: err && err.code ? String(err.code) : null,
    httpStatus: err && err.response ? err.response.status : null,
    message: err && err.message ? String(err.message).slice(0, 200) : null,
  };
}

/**
 * Classify an upstream failure into the taxonomy the UI renders.
 *
 * WHY A TAXONOMY AND NOT null. `forwardGeocode` returns null for everything —
 * missing key, timeout, quota exhausted, place genuinely not found — because its
 * caller (the map) can only ever do one thing with the answer: omit the lane.
 * The PICKER cannot work that way. "No such place" needs a different sentence
 * from "your provider key is not configured", which needs a different sentence
 * from "we have used today's quota" — and the operator can act on two of those
 * three. A single null is how a configuration error becomes a user who believes
 * their warehouse does not exist.
 */
function classifyError(err) {
  const status = err && err.response ? err.response.status : null;
  if (err && (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT")) return "TIMEOUT";
  if (status === 401 || status === 403) return "UNAUTHORISED";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_ERROR";
}

/**
 * Geoapify's `result_type` → our `geo_place.kind` vocabulary.
 *
 * A best guess that the operator can override on confirmation, not a
 * classification we defend: the provider is describing an OSM object and we are
 * describing a role in a shipment. "amenity" covers a terminal, a warehouse and
 * a petrol station, so it maps to the honest ADDRESS rather than to a
 * WAREHOUSE this code cannot actually tell it is.
 */
const KIND_BY_RESULT_TYPE = {
  country: "OTHER",
  state: "OTHER",
  county: "OTHER",
  city: "CITY",
  town: "CITY",
  village: "CITY",
  hamlet: "CITY",
  postcode: "CITY",
  district: "CITY",
  suburb: "CITY",
  street: "ADDRESS",
  building: "ADDRESS",
  amenity: "ADDRESS",
};

/**
 * One provider candidate, normalised and stripped to the fields we store.
 *
 * PROVIDER DATA IS UNTRUSTED. Every string is coerced and length-capped here so
 * a hostile or merely broken upstream payload cannot travel further into the
 * app: the caller receives plain scalars, never a nested provider object, and
 * never a key this module did not choose. Returns null for a candidate with no
 * usable coordinate, because a suggestion nobody can plot is not a suggestion.
 */
function normaliseCandidate(hit) {
  if (!hit || typeof hit !== "object") return null;
  // `Number(null)` is 0 and `Number("")` is 0, so a coerce-then-isFinite check
  // turns a result with NO coordinate into a result AT 0°,0° — in the Gulf of
  // Guinea, a few hundred kilometres off Douala, which is the one place on earth
  // where a bogus pin would look plausible on this product's map. Reject the
  // absent value first, then coerce.
  const blank = (v) => v === null || v === undefined || v === "";
  if (blank(hit.lat) || blank(hit.lon)) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const text = (v, max) => (v === null || v === undefined ? null : String(v).slice(0, max) || null);
  const resultType = text(hit.result_type, 40);
  const confidence = Number(hit.rank && hit.rank.confidence);
  return {
    provider_place_id: text(hit.place_id, 300),
    // Geoapify's `name` is the POI/street name and is absent for a bare city,
    // where `city` or the head of `formatted` is the thing a human would call it.
    name: text(hit.name || hit.city || hit.county || String(hit.formatted || "").split(",")[0], 200),
    formatted: text(hit.formatted, 500),
    country: hit.country_code ? String(hit.country_code).slice(0, 2).toUpperCase() : null,
    region: text(hit.state || hit.county, 120),
    latitude: lat,
    longitude: lon,
    kind: (resultType && KIND_BY_RESULT_TYPE[resultType.toLowerCase()]) || "OTHER",
    result_type: resultType,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
  };
}

async function resolveKey() {
  if (_key !== undefined) return _key;
  let key = null;
  try {
     
    const platformSettings = require("./platform/settings.service");
    const r = await platformSettings.resolve("geocoding", "geoapify");
    key = (r && r.secret) || null;
  } catch {
    /*
     * @silent:storage -- the platform settings store is unreachable, and the
     * env var below is the documented fallback for exactly this case. Nothing is
     * lost by dropping the error: if the env var is also unset, `resolveKey`
     * returns null and every caller reports NO_KEY, which is a better message
     * than "the settings database is down" to the operator who just wanted to
     * find a warehouse. The store's own health is monitored where it lives.
     */
  }
  _key = key || process.env.GEOAPIFY_API_KEY || null;
  return _key;
}

async function reverseGeocode(lat, lng) {
  const apiKey = await resolveKey();
  if (!apiKey) return null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (
    lat === null || lat === undefined || lng === null || lng === undefined ||
    Number.isNaN(latNum) || Number.isNaN(lngNum)
  ) {
    return null;
  }
  try {
    // Geoapify's param names are lat/lon (not lng).
    const { data } = await axios.get(REVERSE_URL, {
      params: { lat: latNum, lon: lngNum, format: "json", limit: 1, apiKey },
      timeout: TIMEOUT_MS,
    });
    return (
      // format=json shape …
      data?.results?.[0]?.formatted ||
      // … and the default GeoJSON shape, in case the format param is dropped.
      data?.features?.[0]?.properties?.formatted ||
      null
    );
  } catch (err) {
    logger.warn({ provider: describeError(err) }, "[geoapify] reverse geocode failed");
    return null;
  }
}

/**
 * Forward geocode a place name → { latitude, longitude, formatted, country }.
 *
 * Added 2026-08-01 for the Control Tower shipment map: dossier.pol / dossier.pod
 * are free text ("Douala", "Paris CDG"), and plotting them needs coordinates.
 * The reverse direction above has existed since the HR geofence work; this is its
 * mirror, sharing the same key resolution, timeout and never-throw contract.
 *
 * NOT called per render. Callers resolve through the `geo_place` cache
 * (migration 0478) and only reach this on a miss, writing the result back — so
 * the free tier is spent once per new place, not once per dashboard load.
 *
 * `bias` is an optional "lon,lat" to prefer nearby matches; the caller passes the
 * tenant's home port so a bare "Kribi" resolves in Cameroon rather than to a
 * same-named place elsewhere. Returns null on missing key, empty query, timeout
 * or any upstream error — same as reverseGeocode, and for the same reason: a map
 * that can't plot one lane must still render the rest.
 */
async function forwardGeocode(place, { bias = null, countryCodes = null } = {}) {
  const apiKey = await resolveKey();
  if (!apiKey) return null;
  const text = String(place || "").trim();
  if (!text) return null;
  try {
    const params = { text, format: "json", limit: 1, apiKey };
    if (bias) params.bias = `proximity:${bias}`;
    // e.g. ["cm","td"] — narrows a corridor city to the countries served.
    if (Array.isArray(countryCodes) && countryCodes.length) {
      params.filter = `countrycode:${countryCodes.join(",").toLowerCase()}`;
    }
    const { data } = await axios.get(SEARCH_URL, { params, timeout: TIMEOUT_MS });
    // format=json returns `results`; without it, GeoJSON `features[].properties`.
    const hit = data?.results?.[0] || data?.features?.[0]?.properties || null;
    if (!hit || typeof hit.lat !== "number" || typeof hit.lon !== "number") return null;
    return {
      latitude: hit.lat,
      longitude: hit.lon,
      formatted: hit.formatted || null,
      country: hit.country_code ? String(hit.country_code).toUpperCase() : null,
    };
  } catch (err) {
    logger.warn({ provider: describeError(err), place: text }, "[geoapify] forward geocode failed");
    return null;
  }
}

/**
 * Search the provider for candidate places — the picker's "search worldwide".
 *
 * THIS IS NOT `forwardGeocode`, and the difference is the whole point.
 * `forwardGeocode` answers "give me the one coordinate for this string" and is
 * used at SAVE time, unattended, where a wrong-but-plausible answer is silently
 * stored. This answers "what might the operator have meant?" and returns SEVERAL
 * candidates with enough context — formatted address, country, region, type,
 * confidence — for a human to pick the right one. Nothing is stored until they
 * do (see geo_place.service.confirmSuggestion).
 *
 * NEVER THROWS, like everything else here, but never returns a bare null either:
 * the result carries a `status` from a fixed taxonomy so the picker can say what
 * happened. `results` is always an array, empty when status is not OK.
 *
 * NOT CALLED ON RENDER, and not called per keystroke: the local catalogue serves
 * typing, and this runs only when a human asks for it or when the catalogue came
 * back empty. Callers must be outside a DB transaction — same contract as the
 * two functions above, same reason (an HTTP wait must not hold a connection).
 *
 * @param {string} text        what the operator typed
 * @param {object} [opts]
 * @param {number} [opts.limit]        candidates wanted, capped at MAX_RESULTS
 * @param {string} [opts.bias]         "lon,lat" to prefer nearby matches
 * @param {string[]} [opts.countryCodes] ISO-3166 alpha-2 filter
 * @returns {Promise<{status: string, results: object[], query: string}>}
 */
async function searchPlaces(text, { limit = 6, bias = null, countryCodes = null } = {}) {
  const query = String(text || "").trim();
  const out = (status, results = []) => ({ status, results, query });

  // Both of these are refusals to spend a request, and both are reported rather
  // than silently returning nothing: "type a bit more" and "nobody has
  // configured a provider" are different problems with different owners.
  if (query.length < MIN_QUERY_CHARS) return out("QUERY_TOO_SHORT");
  const apiKey = await resolveKey();
  if (!apiKey) return out("NO_KEY");

  const wanted = Math.max(1, Math.min(Number(limit) || 6, MAX_RESULTS));
  try {
    const params = { text: query, format: "json", limit: wanted, apiKey };
    if (bias) params.bias = `proximity:${bias}`;
    if (Array.isArray(countryCodes) && countryCodes.length) {
      // Encoded by axios as a normal query param. The values are constrained to
      // two letters by the validator, so nothing here can smuggle a second
      // filter clause into the provider's own filter grammar.
      const codes = countryCodes
        .map((c) => String(c || "").trim().toLowerCase())
        .filter((c) => /^[a-z]{2}$/.test(c));
      if (codes.length) params.filter = `countrycode:${codes.join(",")}`;
    }
    const { data } = await axios.get(AUTOCOMPLETE_URL, { params, timeout: SEARCH_TIMEOUT_MS });
    // format=json gives `results`; without it, GeoJSON `features[].properties`.
    // Both shapes are handled for the same reason forwardGeocode handles both:
    // the param has been dropped by a proxy before now.
    const raw = Array.isArray(data && data.results)
      ? data.results
      : Array.isArray(data && data.features)
        ? data.features.map((f) => (f && f.properties) || null)
        : [];
    const results = [];
    const seen = new Set();
    for (const hit of raw) {
      const candidate = normaliseCandidate(hit);
      if (!candidate) continue;
      // Autocomplete happily returns the same building twice under two ids.
      const dedupe = `${candidate.latitude.toFixed(5)},${candidate.longitude.toFixed(5)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      results.push(candidate);
      if (results.length >= wanted) break;
    }
    return out("OK", results);
  } catch (err) {
    const status = classifyError(err);
    logger.warn({ provider: describeError(err), status, chars: query.length }, "[geoapify] place search failed");
    return out(status);
  }
}

/**
 * Is a provider key configured at all — WITHOUT spending a request to find out.
 *
 * The attendance map asks this before offering preview tiles: with a key it can
 * render them, without one it degrades to coordinates plus an OSM link rather
 * than drawing an empty grey box. `resolveKey` reads the platform settings store
 * (or the env fallback) and caches, so this is a memoised local read and makes
 * no HTTP call — which is why a caller may hold a tenant connection across it,
 * unlike every other function in this module.
 */
async function hasKey() {
  return !!(await resolveKey());
}

module.exports = {
  hasKey,
  reverseGeocode,
  forwardGeocode,
  searchPlaces,
  resetCache,
  // Exported for the tests and for geo_place.service, which needs to know the
  // provider's own minimum before deciding whether to offer a worldwide search.
  MIN_QUERY_CHARS,
  MAX_RESULTS,
};
