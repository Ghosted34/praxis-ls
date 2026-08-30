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
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/**
 * Bias unresolved lookups toward the Gulf of Guinea. Without it a bare "Kribi"
 * or "Garoua" can resolve to a same-named place on another continent — the
 * classic forward-geocoding failure. "lon,lat" per Geoapify's proximity format.
 */
const DEFAULT_BIAS = "9.70,4.05"; // Douala

/**
 * What each provider status means TO AN OPERATOR, in a sentence they can act on.
 *
 * The taxonomy exists so these can differ, and they have to differ: two of the
 * five are somebody's job to fix and the operator needs to know which two. A
 * single "search failed" is how a missing API key gets reported for months as
 * "the address book does not work".
 */
const PROVIDER_MESSAGES = {
  NO_KEY: "Worldwide place search is not configured. Add a Geoapify key in the Platform Console, or add this place manually.",
  TIMEOUT: "The place provider did not answer in time. Try again, or add this place manually.",
  RATE_LIMITED: "The place provider's daily quota is used up. Add this place manually, or try again tomorrow.",
  UNAUTHORISED: "The place provider rejected our key. It needs checking in the Platform Console.",
  PROVIDER_ERROR: "The place provider could not be reached. Try again, or add this place manually.",
  QUERY_TOO_SHORT: "Type at least three characters to search worldwide.",
};

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

/* ── Verified place selection ─────────────────────────────────────────────── */

/**
 * Two places this close together are the same place under two spellings.
 *
 * 0.005° is ~550 m at the equator. Chosen because it is smaller than any two
 * distinct ports and larger than the disagreement between two sources naming
 * the same terminal — so it separates "Kribi vs Kribi" (merge) from "Balboa vs
 * Cristóbal" (do not merge, they are opposite ends of a canal).
 */
const SAME_PLACE_DEGREES = 0.005;

const isSamePoint = (a, b) =>
  Math.abs(Number(a.latitude) - Number(b.latitude)) < SAME_PLACE_DEGREES &&
  Math.abs(Number(a.longitude) - Number(b.longitude)) < SAME_PLACE_DEGREES;

/**
 * A display label for a provider candidate, specific enough to stand alone.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The label becomes the place's `name`, and
 * `normalise(name)` becomes its `query_key` — the identity of the row and the
 * string the dossier field stores. A bare provider `name` is often a fragment
 * ("Zone Industrielle"), which makes both a useless field value and a key that
 * collides with every other industrial zone on earth. Appending the locality
 * from the formatted address fixes both at once: "Zone Industrielle Bassa,
 * Douala" reads correctly on the file AND identifies one row.
 */
function labelFor(candidate) {
  const name = String(candidate.name || "").trim();
  const parts = String(candidate.formatted || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return name.slice(0, 160);
  const head = parts[0];
  // A city needs no qualifier. "Douala, Littoral" is worse than "Douala" on a
  // bill of lading, and the rare genuine collision (two towns of one name) is
  // handled where it belongs — insertDistinct appends the region only when the
  // key is actually taken by a different point.
  if (candidate.kind === "CITY") return (name || head).slice(0, 160);
  // The provider's `name` usually IS the first line of the formatted address.
  // When it is, the second line is the locality that disambiguates it.
  const sameHead = repo.normalise(head) === repo.normalise(name);
  if (name && sameHead && parts.length > 1) return `${head}, ${parts[1]}`.slice(0, 160);
  if (name && !sameHead) return `${name}, ${head}`.slice(0, 160);
  return (name || head).slice(0, 160);
}

/**
 * Insert a place under a key that is genuinely free, or return the row that
 * already holds it when that row is the same place.
 *
 * THE PROBLEM THIS SOLVES. `repo.upsert` is ON CONFLICT DO NOTHING and returns
 * null on a collision. Every existing caller then re-reads the key and uses
 * whatever it finds — correct for `resolveMany`, where the collision means
 * "another request cached this same port first", and WRONG here, where two
 * genuinely different addresses can normalise to one key. Returning the other
 * one would silently pin a dossier to the wrong coordinate, which is exactly the
 * class of failure this whole change exists to remove.
 *
 * So: on a collision, compare coordinates. Same point → that IS the place, reuse
 * it (and never overwrite it — it may be a MANUAL correction). Different point →
 * a real collision, so disambiguate the key and try again, bounded.
 */
async function insertDistinct(client, place, { suffixes }) {
  const attempts = ["", ...suffixes.filter(Boolean)];
  for (const suffix of attempts) {
    const name = suffix ? `${place.name} (${suffix})` : place.name;
    const queryKey = repo.normalise(name);
    if (!queryKey) break;
    const row = await repo.upsert(client, { ...place, name, queryKey });
    if (row) return { row, created: true };
    const [existing] = await repo.findByKeys(client, [queryKey]);
    if (existing && isSamePoint(existing, place)) return { row: existing, created: false };
    // Same key, different point: fall through and try the next suffix.
  }
  return { row: null, created: false };
}

/**
 * Search the catalogue, and optionally ask the provider for what it does not have.
 *
 * CACHE FIRST, ALWAYS. The local catalogue answers every keystroke. The provider
 * is consulted only when the caller asks (`provider: true` — the picker's
 * "search worldwide" action) AND the catalogue has no exact answer, which is the
 * rule that keeps a global search from spending a request on "douala".
 *
 * Returns the provider's typed status alongside the results, never a bare empty
 * list: "nothing matched" and "your provider key is missing" must not look the
 * same to the operator.
 */
async function search(client, { q = null, country = null, kinds = null, limit = 20, provider = false, bias = DEFAULT_BIAS } = {}) {
  const places = await repo.search(client, { q, country, kinds, limit });
  // An exact code or exact name match means the catalogue already knows the
  // answer, so a worldwide search would spend a request to re-derive it.
  const key = repo.normalise(q);
  const code = String(q || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const hasExact = places.some(
    (p) => p.query_key === key || (p.unlocode && p.unlocode === code),
  );

  if (!provider || hasExact) {
    return {
      places,
      has_exact: hasExact,
      provider: { requested: false, status: "NOT_REQUESTED", message: null, results: [] },
    };
  }

  const found = await geoapify.searchPlaces(q, {
    limit: 6,
    bias,
    countryCodes: country ? [country] : null,
  });
  // Candidates the catalogue already holds are folded out — showing "Douala" as
  // a new suggestion next to the Douala the operator can already pick is the
  // kind of duplicate that makes a picker feel untrustworthy.
  const knownKeys = new Set(places.map((p) => p.query_key));
  const suggestions = found.results.filter((c) => !knownKeys.has(repo.normalise(labelFor(c))));
  return {
    places,
    has_exact: false,
    provider: {
      requested: true,
      status: found.status,
      // The sentence travels with the status so the browser never has to own a
      // second copy of this mapping. A client-side table would drift, and the
      // half that drifted would be the half a stuck operator is reading.
      message: found.status === "OK" ? null : PROVIDER_MESSAGES[found.status] || PROVIDER_MESSAGES.PROVIDER_ERROR,
      results: suggestions,
    },
  };
}

/**
 * Cache a provider suggestion the operator has confirmed, and return the row.
 *
 * WHY THE PROVIDER IS RE-QUERIED HERE RATHER THAN TRUSTING THE REQUEST. The
 * browser could otherwise POST any coordinate it liked and have it stored with
 * `source='GEOAPIFY'` — a place that claims a provider vouched for it when
 * nobody did. That is a provenance forgery, and provenance is the entire
 * product claim being made by this feature. So the server re-runs the same
 * search and takes the coordinate from the PROVIDER'S answer, matched by
 * `provider_place_id`; the request body supplies only the query text, the id,
 * and the operator's two decisions (its kind, and whether it is a reference
 * point rather than the exact place).
 *
 * The cost is one provider request per genuinely new place — precisely the
 * budget this module was built around ("spent once per NEW place, not per page
 * load"). The failure mode is visible and recoverable: a suggestion that has
 * aged out of the provider's ranking yields SUGGESTION_EXPIRED, and the picker
 * re-searches rather than storing something nobody confirmed.
 *
 * WHO CONFIRMED IT IS PART OF THE RECORD. `confirmedBy` names them in the
 * stored provenance, and it exists because the public quote wizard (WS2) uses
 * this same path: a prospect picking their own port from the list is a real
 * confirmation and the re-query gives it the same coordinate guarantee, but it
 * is NOT an operator's judgement and the row must not claim it was. The default
 * is the operator, because that was the only caller when this was written.
 */
async function confirmSuggestion(client, { query, providerPlaceId, country = null, kind = null, isReferencePoint = false, confirmedBy = "an operator", actor = {} }) {
  const found = await geoapify.searchPlaces(query, {
    limit: geoapify.MAX_RESULTS,
    bias: DEFAULT_BIAS,
    countryCodes: country ? [country] : null,
  });
  if (found.status !== "OK") {
    throw new AppError(
      "PLACE_PROVIDER_UNAVAILABLE",
      PROVIDER_MESSAGES[found.status] || PROVIDER_MESSAGES.PROVIDER_ERROR,
      502,
      { provider_status: found.status },
    );
  }
  const candidate = found.results.find((c) => c.provider_place_id === providerPlaceId);
  if (!candidate) {
    throw new AppError(
      "PLACE_SUGGESTION_EXPIRED",
      "That suggestion is no longer in the provider's results. Search again and pick it from the new list.",
      409,
    );
  }

  const label = labelFor(candidate);
  const { row, created } = await insertDistinct(
    client,
    {
      name: label,
      country: candidate.country,
      region: candidate.region,
      // The operator's classification wins over the provider's guess: they know
      // whether the building they just found is a warehouse or a customer door.
      kind: kind || candidate.kind || "OTHER",
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      source: "GEOAPIFY",
      formatted: candidate.formatted,
      providerPlaceId: candidate.provider_place_id,
      confidence: candidate.confidence,
      isReferencePoint: !!isReferencePoint,
      // A human looked at this and chose it. That is what verified means here.
      verified: true,
      provenance: `Geoapify autocomplete, confirmed by ${confirmedBy}`,
    },
    // Disambiguators, tried in order, for the rare case where two different
    // addresses normalise to one key.
    { suffixes: [candidate.region, candidate.country] },
  );
  if (!row) {
    throw new AppError(
      "PLACE_NOT_STORED",
      "That place could not be added because a different place is already saved under the same name. Rename it using the manual entry option.",
      409,
    );
  }
  if (created) {
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: "geo_place:" + row.geo_place_id,
      after: row,
    });
  }
  return row;
}

/**
 * Resolve dossier field values against the catalogue — LOCAL ONLY.
 *
 * The verification gate calls this, and it must be a pure database question: a
 * save path that can reach the network can also time out on the network, and
 * "your file could not be opened because a geocoder was slow" is not an
 * acceptable sentence. A place is verified if a human has already put it in the
 * catalogue; that is decidable here, in one query, in a millisecond.
 *
 * Inactive rows count as verified: a file already routed through a terminal that
 * has since closed is still a file with a real origin.
 *
 * @returns {Promise<Map<string, object|null>>} keyed by the ORIGINAL value
 */
async function resolveVerified(client, values) {
  const out = new Map();
  const wanted = [...new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))];
  if (!wanted.length) return out;
  const keyOf = new Map(wanted.map((v) => [v, repo.normalise(v)]));
  const keys = [...new Set(keyOf.values())].filter(Boolean);
  const rows = await repo.findByKeys(client, keys);
  const byKey = new Map(rows.map((r) => [r.query_key, r]));
  wanted.forEach((v) => out.set(v, byKey.get(keyOf.get(v)) || null));
  return out;
}

/**
 * Add a place by hand. Forced to source='MANUAL' regardless of what the caller
 * says — resolveMany treats MANUAL as a human correction that a later geocode
 * must not overwrite, so letting a client claim that provenance would let a bad
 * value pin itself permanently.
 *
 * Manual places are `verified` by definition: a person typed the coordinate on
 * purpose. That is a stronger claim than a provider's guess, not a weaker one,
 * and it is why `resolveMany` protects them.
 *
 * `isReferencePoint` is how an operator says "this is not the exact door, it is
 * the junction we agreed to meet at" — an honest answer that the previous
 * free-text world could not express at all.
 */
async function createManual(client, {
  name, latitude, longitude, country, kind, region = null, unlocode = null,
  formatted = null, isReferencePoint = false, actor = {},
}) {
  const place = {
    name: String(name || "").trim().slice(0, 160),
    country: country ? String(country).toUpperCase() : null,
    region,
    kind: kind || "OTHER",
    latitude,
    longitude,
    source: "MANUAL",
    formatted,
    unlocode: unlocode ? String(unlocode).toUpperCase() : null,
    isReferencePoint: !!isReferencePoint,
    verified: true,
    provenance: "Entered by hand by an operator",
  };
  // No suffixes: a hand-entered name collides only when the operator chose a
  // name that is already taken, and the honest response to that is to say so
  // (below) rather than to invent "Warehouse 3 (CM)" on their behalf.
  const { row, created } = await insertDistinct(client, place, { suffixes: [] });
  if (!row) {
    throw new AppError(
      "PLACE_NAME_TAKEN",
      "A different place is already saved under that name. Give this one a more specific name — including the town usually does it.",
      409,
    );
  }
  if (created) {
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: "geo_place:" + row.geo_place_id,
      after: row,
    });
  }
  return row;
}

module.exports = {
  resolveMany,
  list,
  search,
  confirmSuggestion,
  resolveVerified,
  createManual,
  normalise: repo.normalise,
  // Exported for the tests, which assert the ladder and the messages directly
  // rather than through four layers of HTTP.
  labelFor,
  PROVIDER_MESSAGES,
};
