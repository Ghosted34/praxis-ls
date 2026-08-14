/**
 * geo_place repository — coordinates for the places dossiers route through
 * (migration 0478). SQL lives here only, per doc/CONVENTIONS.md.
 */
"use strict";

/**
 * Normalise a free-text place into the cache key.
 *
 * dossier.pol/pod are typed by hand, so the same port arrives as "N'Djamena",
 * "Ndjamena", "NDJAMENA " and "n'djamena". Fold accents, drop apostrophes and
 * punctuation, collapse whitespace, lowercase — so all four hit one row.
 *
 * Deliberately NOT stripping qualifiers like "port of" or "airport": "Paris CDG"
 * and "Paris" are different points and must not collapse together.
 */
function normalise(place) {
  return String(place || "")
    .normalize("NFD")
    // Escapes, not literal combining marks — this repo has a documented history
    // of the Windows mount mangling non-ASCII in freshly written files.
    .replace(/[̀-ͯ]/g, "") // strip diacritics: Yaoundé → Yaounde
    .replace(/['‘’`]/g, "") // N'Djamena / N’Djamena → NDjamena
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Every column the picker, the map and the verification gate read.
 *
 * Named rather than `SELECT *` because this list IS the response contract — the
 * client's `GeoPlace` type is checked against it by check-response-contract.js,
 * and a `*` makes every future column an accidental part of the API.
 */
const COLUMNS =
  "geo_place_id, query_key, name, country, region, kind, unlocode, formatted, " +
  "latitude, longitude, source, provenance, confidence, is_reference_point, " +
  "is_active, verified_at, resolved_at";

/** Freight-first kind ordering, shared by both branches of `search` so a filtered
 *  browse and a search agree about what a "place" usually is on this product. */
const KIND_ORDER =
  "CASE kind WHEN 'SEAPORT' THEN 0 WHEN 'AIRPORT' THEN 1 WHEN 'TERMINAL' THEN 2 " +
  "WHEN 'RAIL_TERMINAL' THEN 3 WHEN 'INLAND' THEN 4 WHEN 'BORDER_POST' THEN 5 " +
  "WHEN 'WAREHOUSE' THEN 6 WHEN 'CITY' THEN 7 WHEN 'ADDRESS' THEN 8 ELSE 9 END";

/**
 * Look up many places at once — one query per render, not one per lane.
 *
 * Does NOT filter on `is_active`: this is the resolution path, and a dossier
 * pointing at a terminal that has since closed must still plot. `search` is the
 * one that hides inactive rows, because that is the path that OFFERS a place.
 */
async function findByKeys(client, keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const { rows } = await client.query(
    // geo_place_id is selected because callers don't only want coordinates —
    // the dossier save path stores the id on pol_place_id / pod_place_id.
    `SELECT ${COLUMNS} FROM geo_place WHERE query_key = ANY($1::text[])`,
    [keys],
  );
  return rows;
}

/** Resolve places by primary key — the itinerary and dossier read paths, which
 *  hold ids rather than text. One query for a whole itinerary, not one per leg. */
async function findByIds(client, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM geo_place WHERE geo_place_id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/**
 * Write a resolved coordinate back to the cache.
 *
 * ON CONFLICT DO NOTHING, not DO UPDATE: a row may have been hand-corrected
 * (source='MANUAL') after a bad geocode, and a later lookup must not silently
 * overwrite that correction with the provider's answer again.
 */
async function upsert(client, {
  queryKey, name, country, kind, latitude, longitude, source, formatted,
  unlocode = null, region = null, providerPlaceId = null, confidence = null,
  isReferencePoint = false, verified = false, provenance = null,
}) {
  const { rows } = await client.query(
    "INSERT INTO geo_place (query_key, name, country, kind, latitude, longitude, source, formatted, " +
      "unlocode, region, provider_place_id, confidence, is_reference_point, verified_at, provenance) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) " +
      "ON CONFLICT (query_key) DO NOTHING RETURNING *",
    [
      queryKey, name, country || null, kind || "OTHER", latitude, longitude,
      source || "GEOAPIFY", formatted || null,
      unlocode || null, region || null, providerPlaceId || null,
      confidence === null || confidence === undefined ? null : confidence,
      !!isReferencePoint,
      // A human confirmed this one → stamp it. A background geocode did not →
      // leave it NULL, which is what puts it in the location-needed queue.
      verified ? new Date().toISOString() : null,
      provenance || null,
    ],
  );
  return rows[0] || null;
}

/**
 * Ranked, cache-first place search — what the picker types against.
 *
 * THE RANKING IS THE FEATURE, and it is deliberately explicit SQL rather than a
 * similarity score. An operator typing "dou" wants Douala first, every time, on
 * every tenant; a float that reorders results when the catalogue grows is not a
 * usable picker. So the order is a fixed ladder:
 *
 *   0  exact UN/LOCODE or IATA code   — "CMDLA", "NBO": they typed an identifier
 *   1  exact normalised name          — "douala"
 *   2  name starts with the term      — "dou" → Douala, Douala Airport
 *   3  name contains the term         — "gentil" → Port-Gentil
 *   4  formatted address contains it  — how "NBO" reaches Nairobi's airport
 *
 * …then, within a rank: verified before unverified, exact places before
 * reference points, ports and airports before cities (a freight file usually
 * means the port), then name, then id. The last two make it TOTAL — no tie is
 * broken by whatever order the planner happened to return, so the same query
 * gives the same page twice.
 *
 * INACTIVE ROWS ARE EXCLUDED. A retired terminal must stop being offered while
 * still resolving for the files that already point at it (findByKeys/findByIds
 * do not filter, and that is the difference between them and this).
 *
 * Every LIKE pattern is built from `normalise`d text, which strips everything
 * outside [a-z0-9 ] — so `%` and `_` cannot reach the pattern and there is no
 * wildcard injection to escape. Values are bound, never interpolated.
 */
async function search(client, { q = null, country = null, kinds = null, limit = 20, includeInactive = false } = {}) {
  const term = normalise(q);
  // Codes are matched whole: a UN/LOCODE is 5 chars, an IATA code is 3, and
  // "por" must not be treated as a code hunt for every three-letter word.
  const code = String(q || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const params = [];
  const add = (v) => { params.push(v); return "$" + params.length; };

  const where = [];
  if (!includeInactive) where.push("is_active");
  if (country) where.push("country = " + add(String(country).toUpperCase().slice(0, 2)));
  if (Array.isArray(kinds) && kinds.length) where.push("kind = ANY(" + add(kinds) + "::text[])");

  // No term: the browsable catalogue, filtered. Same shape of answer, so the
  // caller does not need two code paths for "searching" and "just looking".
  if (!term && !code) {
    const { rows } = await client.query(
      `SELECT ${COLUMNS} FROM geo_place${where.length ? " WHERE " + where.join(" AND ") : ""} ` +
        `ORDER BY (verified_at IS NOT NULL) DESC, ${KIND_ORDER}, name, geo_place_id LIMIT ${add(limit)}`,
      params,
    );
    return rows;
  }

  // NULL, not a sentinel string, when the term cannot be a code. `unlocode = NULL`
  // is never true in SQL, which is exactly the semantics wanted, and it removes
  // the need for a magic value that must not collide with a real code.
  const pCode = add(code.length === 5 || code.length === 3 ? code : null);
  const pTerm = add(term);
  const pPrefix = add(term + "%");
  const pContains = add("%" + term + "%");
  where.push(
    `(unlocode = ${pCode} OR formatted ILIKE ${pContains} OR query_key = ${pTerm} ` +
      `OR query_key LIKE ${pPrefix} OR query_key LIKE ${pContains})`,
  );

  const { rows } = await client.query(
    `SELECT ${COLUMNS},
            CASE
              WHEN unlocode = ${pCode} THEN 0
              WHEN query_key = ${pTerm} THEN 1
              WHEN query_key LIKE ${pPrefix} THEN 2
              WHEN query_key LIKE ${pContains} THEN 3
              ELSE 4
            END AS match_rank
       FROM geo_place
      WHERE ${where.join(" AND ")}
      ORDER BY match_rank,
               (verified_at IS NOT NULL) DESC,
               is_reference_point,
               ${KIND_ORDER},
               name,
               geo_place_id
      LIMIT ${add(limit)}`,
    params,
  );
  return rows;
}

/**
 * The legacy list endpoint, unchanged in contract.
 *
 * Kept because `SearchSelect` and two settings screens call `/geo-places?q=`
 * and expect ILIKE-anywhere behaviour with no ranking. New callers use `search`.
 */
async function list(client, { q = null, limit = 200 } = {}) {
  const params = [limit];
  let where = "";
  if (q) {
    params.push(`%${q}%`);
    where = ` WHERE name ILIKE $${params.length} OR query_key ILIKE $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT * FROM geo_place${where} ORDER BY name LIMIT $1`,
    params,
  );
  return rows;
}

module.exports = { normalise, findByKeys, findByIds, upsert, search, list, COLUMNS };
