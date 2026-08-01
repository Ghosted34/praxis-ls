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
const TIMEOUT_MS = 3000;

let _key; // undefined = unresolved; null/string = resolved
function resetCache() { _key = undefined; }

async function resolveKey() {
  if (_key !== undefined) return _key;
  let key = null;
  try {
    // eslint-disable-next-line global-require
    const platformSettings = require("./platform/settings.service");
    const r = await platformSettings.resolve("geocoding", "geoapify");
    key = (r && r.secret) || null;
  } catch {
    // platform store unavailable → env fallback
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
    logger.warn({ err: err.message }, "[geoapify] reverse geocode failed");
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
    logger.warn({ err: err.message, place: text }, "[geoapify] forward geocode failed");
    return null;
  }
}

module.exports = { reverseGeocode, forwardGeocode, resetCache };
