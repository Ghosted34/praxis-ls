/**
 * dossier_itinerary_leg repository (0672, extended by 0677). SQL lives here only,
 * per doc/CONVENTIONS.md.
 */
"use strict";

const LEG_TYPES = new Set(["PICKUP", "MAIN_CARRIAGE", "CUSTOMS", "INLAND_TRANSIT", "WAREHOUSE", "FINAL_DELIVERY", "OTHER"]);
const MODES = new Set(["AIR", "SEA", "LAND", "RAIL", "OTHER"]);
const STATUSES = new Set(["PLANNED", "IN_PROGRESS", "COMPLETED", "BLOCKED", "CANCELLED"]);
const SOURCES = new Set(["TEMPLATE", "MANUAL"]);

/**
 * The last line of defence, and it is deliberately a throw rather than a 422.
 *
 * The validator has already checked the request; this catches a caller INSIDE the
 * server passing a leg the DB would reject — the itinerary seeder reading a
 * service type's template, the AI action registry, a future import. A CHECK
 * violation from Postgres names the constraint and not the leg, so failing here
 * is the difference between "invalid itinerary leg type" and error 23514.
 */
function assertLeg(leg) {
  if (!LEG_TYPES.has(leg.leg_type)) throw new Error("Invalid itinerary leg type: " + leg.leg_type);
  if (!MODES.has(leg.mode)) throw new Error("Invalid itinerary leg mode: " + leg.mode);
  if (!STATUSES.has(leg.status || "PLANNED")) throw new Error("Invalid itinerary leg status: " + leg.status);
  if (!SOURCES.has(leg.source || "MANUAL")) throw new Error("Invalid itinerary leg source: " + leg.source);
}

/**
 * Every column a leg carries, plus BOTH endpoints resolved through geo_place.
 *
 * THE VERIFICATION FIELDS ARE THE POINT OF THIS SELECT. A leg holds two text
 * columns and two nullable place references, so "Douala → Ndjamena" can mean
 * three different things: both ends verified and mappable, one end verified, or
 * neither (legacy text that predates the picker). The Control Tower has to be
 * able to tell those apart — a route it draws is a claim — so the join carries
 * `verified_at` and `is_reference_point` for each end rather than only the
 * coordinates. The service turns them into one honest per-leg verdict.
 *
 * `latitude`/`longitude` are numeric(9,6) and come back from pg as STRINGS.
 * Coercion happens in the service, once, for the same reason geo_place does it
 * there: the frontend doing arithmetic on "4.048200" silently yields NaN.
 */
const LEG_COLUMNS = `
  l.itinerary_leg_id, l.dossier_id, l.seq, l.leg_type, l.mode,
  l.origin, l.destination, l.origin_place_id, l.destination_place_id,
  l.planned_departure, l.planned_arrival, l.actual_departure, l.actual_arrival,
  l.status, l.provider_id, l.notes, l.is_optional, l.source,
  l.milestone_instance_id,
  gp_o.name AS origin_place_name, gp_o.latitude AS origin_latitude, gp_o.longitude AS origin_longitude,
  gp_o.kind AS origin_kind, gp_o.unlocode AS origin_unlocode,
  gp_o.verified_at AS origin_verified_at, gp_o.is_reference_point AS origin_is_reference_point,
  gp_d.name AS destination_place_name, gp_d.latitude AS destination_latitude, gp_d.longitude AS destination_longitude,
  gp_d.kind AS destination_kind, gp_d.unlocode AS destination_unlocode,
  gp_d.verified_at AS destination_verified_at, gp_d.is_reference_point AS destination_is_reference_point,
  rp.name AS provider_name`;

const LEG_JOINS = `
  FROM dossier_itinerary_leg l
  LEFT JOIN geo_place gp_o ON gp_o.geo_place_id = l.origin_place_id
  LEFT JOIN geo_place gp_d ON gp_d.geo_place_id = l.destination_place_id
  LEFT JOIN rate_provider rp ON rp.rate_provider_id = l.provider_id`;

async function list(client, dossierId) {
  const { rows } = await client.query(
    `SELECT ${LEG_COLUMNS} ${LEG_JOINS} WHERE l.dossier_id = $1 ORDER BY l.seq`,
    [dossierId],
  );
  return rows;
}

/**
 * Every leg for MANY dossiers at once — what the Control Tower loads.
 *
 * One query per page of files, not one per file. The map draws a leg-level route
 * for every open file on screen, so the per-dossier version of this was 50
 * round trips on the product's most-visited screen.
 */
async function listForDossiers(client, dossierIds) {
  if (!Array.isArray(dossierIds) || !dossierIds.length) return [];
  const { rows } = await client.query(
    `SELECT ${LEG_COLUMNS} ${LEG_JOINS} WHERE l.dossier_id = ANY($1::uuid[]) ORDER BY l.dossier_id, l.seq`,
    [dossierIds],
  );
  return rows;
}

/**
 * Replace a dossier's whole itinerary.
 *
 * WHY REPLACE AND NOT PATCH. The editor lets an operator reorder legs, and `seq`
 * carries a UNIQUE (dossier_id, seq) constraint — so swapping two legs by
 * updating each in turn transiently collides and fails. Replace also makes
 * "remove a leg" a deletion rather than a tombstone, which keeps the ordering
 * dense and the read path free of a filter.
 *
 * IN ONE TRANSACTION, which it was not before. The DELETE and the INSERTs were
 * separate statements on a pooled client, so a leg that violated a CHECK on
 * insert left the dossier with NO itinerary at all — the whole route silently
 * gone, and the operator looking at a save error that said nothing about it.
 * Now it either replaces or changes nothing.
 *
 * SEQ IS ASSIGNED HERE, from array position, and the caller's `seq` is ignored.
 * Ordering is what the array means; letting a client send its own sequence
 * numbers is how you get two legs numbered 3 and a UNIQUE violation reported as
 * a database error.
 */
async function replace(client, dossierId, legs) {
  const clean = (legs || []).map((l, i) => {
    const leg = {
      ...l,
      seq: i + 1,
      status: l.status || "PLANNED",
      mode: l.mode || "OTHER",
      source: l.source || "MANUAL",
    };
    assertLeg(leg);
    return leg;
  });

  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM dossier_itinerary_leg WHERE dossier_id = $1", [dossierId]);
    for (const l of clean) {
      await client.query(
        "INSERT INTO dossier_itinerary_leg (dossier_id,seq,leg_type,mode,origin,destination," +
          "origin_place_id,destination_place_id,planned_departure,planned_arrival," +
          "actual_departure,actual_arrival,status,provider_id,notes,is_optional,source,milestone_instance_id) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
        [
          dossierId, l.seq, l.leg_type, l.mode, l.origin || null, l.destination || null,
          l.origin_place_id || null, l.destination_place_id || null,
          l.planned_departure || null, l.planned_arrival || null,
          l.actual_departure || null, l.actual_arrival || null,
          l.status, l.provider_id || null, l.notes || null, !!l.is_optional, l.source,
          l.milestone_instance_id || null,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return list(client, dossierId);
}

module.exports = {
  list,
  listForDossiers,
  replace,
  LEG_TYPES: [...LEG_TYPES],
  MODES: [...MODES],
  STATUSES: [...STATUSES],
  SOURCES: [...SOURCES],
};
