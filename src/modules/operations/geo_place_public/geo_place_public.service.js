"use strict";

/**
 * Place search for a stranger typing a route into the quote wizard.
 *
 * ── WHY THIS IS NOT `geo_place.search` WITH THE PERMISSION REMOVED ─────────
 *
 * That function returns the tenant's own `geo_place` CATALOGUE first and only
 * asks the provider when the catalogue has no exact match — which is exactly
 * right for an operator and a data leak here. The catalogue is where the desk
 * saves the places it works with: customer doors, a consignee's yard, the
 * warehouse of a named client. `geo_place.createManual` exists so they can add
 * precisely those. Exposing that search to the internet would let anyone type
 * three letters and enumerate a forwarder's client addresses, one prefix at a
 * time, at whatever the rate limit allows.
 *
 * So this asks the PROVIDER and nothing else. Geoapify's answers are public
 * geography; the tenant's catalogue never appears in a response, and no row is
 * read from the tenant database on this path at all.
 *
 * ── WHY THE STATUS IS COLLAPSED ────────────────────────────────────────────
 *
 * `geo_place.PROVIDER_MESSAGES` distinguishes NO_KEY / UNAUTHORISED /
 * RATE_LIMITED / TIMEOUT / PROVIDER_ERROR because an operator can act on the
 * first two — "add a Geoapify key in the Platform Console", "the provider
 * rejected our key". A visitor can act on none of them, and each of those
 * sentences reports the state of our configuration to the internet. To a
 * stranger they are one fact: search is not available right now, type the place
 * instead. That is what goes out.
 *
 * No message travels with it either. The site is bilingual and the browser owns
 * its own copy, so a sentence composed here would be English on a French page.
 */

const geoapify = require("../../../services/geoapify.service");
const { logger } = require("../../../config/logger");

/** Visitors get three tokens; the browser turns them into sentences. */
const PUBLIC_STATUS = {
  OK: "OK",
  QUERY_TOO_SHORT: "TOO_SHORT",
};

/**
 * Douala. The bias that makes "port" mean the one this tenant works through.
 *
 * Not a filter — a prospect shipping from Shanghai must still find Shanghai —
 * only a tie-breaker on ranking, which is what `proximity:` does. The value
 * matches DEFAULT_BIAS in geo_place.service so the picker a visitor uses and
 * the picker the desk uses rank the same places the same way.
 */
const DEFAULT_BIAS = "9.7,4.05";

/** What a visitor is allowed to learn about a candidate. */
function publicCandidate(c) {
  return {
    provider_place_id: c.provider_place_id,
    name: c.name,
    formatted: c.formatted,
    country: c.country,
    latitude: c.latitude,
    longitude: c.longitude,
    kind: c.kind,
  };
}

/**
 * @param {string} q     what the visitor has typed so far
 * @param {string|null} country  optional ISO-3166 alpha-2 narrowing
 * @returns {Promise<{status: "OK"|"TOO_SHORT"|"UNAVAILABLE", results: object[]}>}
 */
async function search(q, { country = null, limit = 6 } = {}) {
  const found = await geoapify.searchPlaces(q, {
    limit,
    bias: DEFAULT_BIAS,
    countryCodes: country ? [country] : null,
  });

  const status = PUBLIC_STATUS[found.status];
  if (!status) {
    // Everything else — no key, bad key, quota gone, timeout, upstream 500.
    // The real status is logged because somebody has to be able to tell a
    // misconfiguration from an outage; it is not returned, because the person
    // who can fix either is not the one reading the page.
    logger.warn(
      { providerStatus: found.status },
      "[geo_place_public] place search unavailable",
    );
    return { status: "UNAVAILABLE", results: [] };
  }

  return { status, results: found.results.map(publicCandidate) };
}

module.exports = { search, publicCandidate, DEFAULT_BIAS };
