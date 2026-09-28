/**
 * Places a signed-in client may be offered — SQL only (doc/CONVENTIONS.md).
 *
 * Two lists the catalogue search cannot give on its own, because both are
 * about WHO is asking rather than what they typed:
 *
 *   · the client's OWN places — every place already on one of their quote
 *     requests or files, addresses included, newest first. Theirs to see by
 *     construction: they (or the desk, for them) put each one there;
 *   · the tenant's POPULAR places — the ports and airports its files and
 *     requests route through most, so "Destination airport" opens on Douala
 *     rather than on an alphabetical list starting at Aarhus.
 *
 * Neither may reach another client's door. `recent` is scoped by client_id in
 * every branch of the union; `popular` is restricted to the public kinds the
 * caller passes (ports, airports, terminals, cities — never an ADDRESS or a
 * WAREHOUSE) and to confirmed exact places, so a count can only ever surface
 * shared infrastructure.
 *
 * Files are read through `dossier_visible`, never the base table: both lists
 * ENUMERATE, and a DRAFT the desk is still typing is not a file a client has
 * (tests/unit/dossier-draft-isolation.test.js).
 */
"use strict";

const { normalise } = require("../operations/geo_place/geo_place.repo");

/**
 * What the portal reads about a place. Narrower than geo_place's own COLUMNS on
 * purpose: provenance, confidence and the provider's id describe how the desk
 * came to trust a row, and none of that is the client's business.
 */
const PLACE_COLUMNS =
  "g.geo_place_id, g.name, g.country, g.region, g.kind, g.unlocode, g.formatted, " +
  "g.latitude, g.longitude";

/**
 * Every place this client's own records point at, as (id, when).
 *
 * The four quote-request ends and the two dossier ends are the only place
 * references a client owns. One union, reused by both queries below, so "what
 * counts as yours" is defined once.
 */
const CLIENT_PLACES =
  "SELECT origin_place_id AS place_id, created_at AS used_at FROM quote_request WHERE client_id = $1 " +
  "UNION ALL SELECT destination_place_id, created_at FROM quote_request WHERE client_id = $1 " +
  "UNION ALL SELECT collection_place_id, created_at FROM quote_request WHERE client_id = $1 " +
  "UNION ALL SELECT delivery_place_id, created_at FROM quote_request WHERE client_id = $1 " +
  "UNION ALL SELECT pol_place_id, created_at FROM dossier_visible WHERE client_id = $1 " +
  "UNION ALL SELECT pod_place_id, created_at FROM dossier_visible WHERE client_id = $1";

/**
 * The client's places, most recently used first, optionally narrowed to kinds
 * and to a typed term. Inactive places are left out: this is an OFFER, and a
 * terminal that has closed must stop being offered (geo_place.repo.search draws
 * the same line).
 */
async function recentPlaces(client, clientId, { kinds = null, q = null, limit = 5 } = {}) {
  const params = [clientId];
  const add = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  const where = ["g.is_active"];
  if (Array.isArray(kinds) && kinds.length) where.push("g.kind = ANY(" + add(kinds) + "::text[])");
  const term = normalise(q);
  // `normalise` leaves only [a-z0-9 ], so no LIKE wildcard can arrive in it.
  if (term) where.push("g.query_key LIKE " + add("%" + term + "%"));
  const { rows } = await client.query(
    `SELECT ${PLACE_COLUMNS}, max(u.used_at) AS last_used
       FROM (${CLIENT_PLACES}) u
       JOIN geo_place g ON g.geo_place_id = u.place_id
      WHERE ${where.join(" AND ")}
      GROUP BY g.geo_place_id
      ORDER BY max(u.used_at) DESC, g.name, g.geo_place_id
      LIMIT ${add(limit)}`,
    params,
  );
  return rows;
}

/**
 * Is this place one of the client's own? The gate a submitted catalogue pick
 * passes when it is not public infrastructure — "same as last time" re-sends
 * the address they used last time, and that must resolve.
 */
async function clientHasPlace(client, clientId, placeId) {
  const { rows } = await client.query(
    `SELECT 1 FROM (${CLIENT_PLACES}) u WHERE u.place_id = $2 LIMIT 1`,
    [clientId, placeId],
  );
  return rows.length > 0;
}

/**
 * The tenant's most-used public places of the given kinds.
 *
 * Counted over the last year of files and requests, so a corridor the tenant
 * stopped working stops leading the list. `kinds` is REQUIRED and is the
 * privacy line (see the file header) — called without it, this returns nothing
 * rather than every kind.
 */
async function popularPlaces(client, { kinds, limit = 5 } = {}) {
  if (!Array.isArray(kinds) || !kinds.length) return [];
  const { rows } = await client.query(
    `SELECT ${PLACE_COLUMNS}, count(*) AS uses
       FROM (
         SELECT pol_place_id AS place_id FROM dossier_visible
          WHERE pol_place_id IS NOT NULL AND created_at > now() - interval '1 year'
         UNION ALL SELECT pod_place_id FROM dossier_visible
          WHERE pod_place_id IS NOT NULL AND created_at > now() - interval '1 year'
         UNION ALL SELECT origin_place_id FROM quote_request
          WHERE origin_place_id IS NOT NULL AND created_at > now() - interval '1 year'
         UNION ALL SELECT destination_place_id FROM quote_request
          WHERE destination_place_id IS NOT NULL AND created_at > now() - interval '1 year'
       ) u
       JOIN geo_place g ON g.geo_place_id = u.place_id
      WHERE g.is_active
        AND g.verified_at IS NOT NULL
        AND NOT g.is_reference_point
        AND g.kind = ANY($1::text[])
      GROUP BY g.geo_place_id
      ORDER BY count(*) DESC, g.name, g.geo_place_id
      LIMIT $2`,
    [kinds, limit],
  );
  return rows;
}

/** One place by id, with the facts the pick gate decides on. */
async function placeById(client, placeId) {
  const { rows } = await client.query(
    `SELECT ${PLACE_COLUMNS}, g.is_active, g.verified_at, g.is_reference_point
       FROM geo_place g WHERE g.geo_place_id = $1`,
    [placeId],
  );
  return rows[0] || null;
}

module.exports = { recentPlaces, clientHasPlace, popularPlaces, placeById, PLACE_COLUMNS };
