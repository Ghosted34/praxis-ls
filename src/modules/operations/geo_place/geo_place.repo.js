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

/** Look up many places at once — one query per render, not one per lane. */
async function findByKeys(client, keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const { rows } = await client.query(
    // geo_place_id is selected because callers don't only want coordinates —
    // the dossier save path stores the id on pol_place_id / pod_place_id.
    "SELECT geo_place_id, query_key, name, country, kind, latitude, longitude, source " +
      "FROM geo_place WHERE query_key = ANY($1::text[])",
    [keys],
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
async function upsert(client, { queryKey, name, country, kind, latitude, longitude, source, formatted }) {
  const { rows } = await client.query(
    "INSERT INTO geo_place (query_key, name, country, kind, latitude, longitude, source, formatted) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (query_key) DO NOTHING RETURNING *",
    [queryKey, name, country || null, kind || "OTHER", latitude, longitude, source || "GEOAPIFY", formatted || null],
  );
  return rows[0] || null;
}

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

module.exports = { normalise, findByKeys, upsert, list };
