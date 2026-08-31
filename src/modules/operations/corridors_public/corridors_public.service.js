"use strict";

/**
 * Corridors — the lanes this tenant has actually run, aggregated from the
 * itinerary ledger for the public website.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The marketing page's proof band shows published case notes, and a tenant who
 * has published none gets a sentence saying so. `WEB_BUILD_BRIEF.md` N12 is
 * right that the answer to an empty band is not an invented statistic — but it
 * does not follow that the band must stay empty. The corridors below are not
 * marketing copy and they are not typed by anyone: they are a GROUP BY over
 * `dossier_itinerary_leg` rows that operations closed. Nobody writes them,
 * nobody maintains them, and they cannot say something the ledger does not.
 *
 * ── THE PRIVACY FLOOR, WHICH IS THE WHOLE DESIGN ───────────────────────────
 *
 * An aggregate over few enough rows is not an aggregate, it is a disclosure. One
 * completed Douala → Malabo leg published on a website tells a competitor who
 * shipped, roughly what, and roughly when — and the client never agreed to that.
 * `success_story` has consent (`public_reference_consent`) precisely because
 * naming a client is the client's decision; a corridor row has no such column,
 * so the protection has to be structural:
 *
 *   MIN_DOSSIERS  a corridor must aggregate at least this many DISTINCT files
 *   MIN_CLIENTS   …belonging to at least this many DISTINCT clients
 *
 * Both, not either. Five files for one client is still one client's shipping
 * pattern; three clients across three files is three identifiable shipments. The
 * pair is a k-anonymity floor, and the honest consequence is that a young tenant,
 * or one with a concentrated book, publishes NOTHING here. That is the correct
 * failure: the band falls back to the drawn panel, which claims nothing.
 *
 * Raising these is safe. Lowering them is a disclosure decision and belongs to
 * whoever owns the client relationships, not to this file.
 */

const MIN_DOSSIERS = 5;
const MIN_CLIENTS = 3;

/** Trailing window. A corridor the tenant last ran four years ago is not a lane
 *  they serve, and presenting it as one is the same category of claim N12
 *  forbids — stale truth read as current capability. */
const WINDOW_MONTHS = 24;

/** Enough to fill a band, few enough that the tail (a corridor run exactly
 *  MIN_DOSSIERS times) never outranks the lanes this tenant actually lives on. */
const MAX_ROWS = 8;

/**
 * Only legs whose BOTH endpoints resolved to a `geo_place` are counted.
 *
 * The free-text `origin`/`destination` columns exist and are populated, but they
 * are typed by operators: "Douala", "douala", "Douala Port" and "DLA" are four
 * groups in a GROUP BY and one place in the world. Aggregating them fragments
 * every corridor into pieces small enough to fall under the floor — and, worse,
 * publishes the same lane four times under four spellings. The resolved place
 * also carries the country, which is what makes a corridor legible to a reader
 * who does not know the region.
 */
async function corridors(client) {
  const { rows } = await client.query(
    `SELECT op.name           AS origin,
            op.country        AS origin_country,
            dp.name           AS destination,
            dp.country        AS destination_country,
            l.mode            AS mode,
            COUNT(DISTINCT l.dossier_id)::int AS files,
            MAX(l.planned_arrival)            AS last_run
       FROM dossier_itinerary_leg l
       JOIN dossier d
         ON d.dossier_id = l.dossier_id
       JOIN geo_place op
         ON op.geo_place_id = l.origin_place_id
       JOIN geo_place dp
         ON dp.geo_place_id = l.destination_place_id
      WHERE l.status = 'COMPLETED'
        AND d.status = 'COMPLETED'
        AND d.client_id IS NOT NULL
        -- A leg with no arrival date cannot be placed inside the trailing
        -- window, so it cannot support a claim about what we run today.
        AND l.planned_arrival IS NOT NULL
        AND l.planned_arrival >= (CURRENT_DATE - make_interval(months => $1::int))
        AND op.geo_place_id <> dp.geo_place_id
      GROUP BY op.name, op.country, dp.name, dp.country, l.mode
     HAVING COUNT(DISTINCT l.dossier_id) >= $2
        AND COUNT(DISTINCT d.client_id) >= $3
      ORDER BY COUNT(DISTINCT l.dossier_id) DESC, MAX(l.planned_arrival) DESC
      LIMIT $4`,
    [WINDOW_MONTHS, MIN_DOSSIERS, MIN_CLIENTS, MAX_ROWS],
  );

  return rows.map((r) => ({
    origin: r.origin,
    origin_country: r.origin_country,
    destination: r.destination,
    destination_country: r.destination_country,
    // AIR | SEA | LAND | OTHER, straight off the leg. The website paints each
    // one in the matching `--mode-*` token, so the colour on the marketing page
    // and the colour on the Control Tower map mean the same thing.
    mode: r.mode,
    // The count is published; the client list that produced it is not, and no
    // identifier from either side of the join leaves this function.
    files: r.files,
    // `client_count` is deliberately NOT returned. It is a floor to be passed,
    // not a figure to display: "3 clients" on a public page is a smaller number
    // than most readers assume, and it invites exactly the question the floor
    // exists to prevent.
  }));
}

module.exports = { corridors, MIN_DOSSIERS, MIN_CLIENTS, WINDOW_MONTHS };
