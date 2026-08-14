"use strict";

const LEG_TYPES = new Set(["PICKUP", "MAIN_CARRIAGE", "CUSTOMS", "INLAND_TRANSIT", "WAREHOUSE", "FINAL_DELIVERY", "OTHER"]);
const MODES = new Set(["AIR", "SEA", "LAND", "OTHER"]);
const STATUSES = new Set(["PLANNED", "IN_PROGRESS", "COMPLETED", "BLOCKED", "CANCELLED"]);

function assertLeg(leg) {
  if (!LEG_TYPES.has(leg.leg_type)) throw new Error("Invalid itinerary leg type");
  if (!MODES.has(leg.mode)) throw new Error("Invalid itinerary leg mode");
  if (!STATUSES.has(leg.status || "PLANNED")) throw new Error("Invalid itinerary leg status");
}

async function list(client, dossierId) {
  const { rows } = await client.query(
    "SELECT l.*, gp_o.name AS origin_name, gp_o.latitude AS origin_latitude, gp_o.longitude AS origin_longitude, " +
    "gp_d.name AS destination_name, gp_d.latitude AS destination_latitude, gp_d.longitude AS destination_longitude " +
    "FROM dossier_itinerary_leg l LEFT JOIN geo_place gp_o ON gp_o.geo_place_id = l.origin_place_id " +
    "LEFT JOIN geo_place gp_d ON gp_d.geo_place_id = l.destination_place_id " +
    "WHERE l.dossier_id = $1 ORDER BY l.seq",
    [dossierId],
  );
  return rows;
}

async function replace(client, dossierId, legs) {
  const clean = (legs || []).map((l, i) => {
    const leg = { ...l, seq: l.seq ?? i + 1, status: l.status || "PLANNED", mode: l.mode || "OTHER" };
    assertLeg(leg);
    return leg;
  });
  await client.query("DELETE FROM dossier_itinerary_leg WHERE dossier_id = $1", [dossierId]);
  for (const l of clean) {
    await client.query(
      "INSERT INTO dossier_itinerary_leg (dossier_id,seq,leg_type,mode,origin,destination,origin_place_id,destination_place_id,planned_departure,planned_arrival,status,provider_id,notes,is_optional) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [dossierId,l.seq,l.leg_type,l.mode,l.origin||null,l.destination||null,l.origin_place_id||null,l.destination_place_id||null,l.planned_departure||null,l.planned_arrival||null,l.status,l.provider_id||null,l.notes||null,!!l.is_optional],
    );
  }
  return list(client, dossierId);
}
module.exports = { list, replace, LEG_TYPES: [...LEG_TYPES], MODES: [...MODES], STATUSES: [...STATUSES] };
