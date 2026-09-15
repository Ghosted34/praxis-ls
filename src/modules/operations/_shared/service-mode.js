"use strict";

/**
 * The transport mode a service type moves cargo by, derived from its key.
 *
 * ── WHY IT LIVES HERE NOW ──────────────────────────────────────────────────
 *
 * It was a private function of `tracking_public.service.js`, where the tracking
 * page uses it to pick a glyph and to name the two ends of a route. The public
 * services read needs exactly the same answer, for exactly the same reason: the
 * quote wizard was asking a stranger "how is it moving?" from a list of four
 * hardcoded options while the tenant's own service taxonomy — the answer to that
 * question — sat one join away. Two callers deriving a mode from the same column
 * with two copies of the rules is how a ship on the tracking page ends up next to
 * "Place of collection" on the quote form.
 *
 * ── WHY IT IS DERIVED AND NOT A COLUMN ─────────────────────────────────────
 *
 * `service_type` has no mode column and should not grow one: services are DATA
 * (0310_operations.sql — "user-creatable"), so a tenant can add
 * SEA_FREIGHT_TRANSSHIPMENT tomorrow and would otherwise have to come back to
 * engineering to make it show a ship. Reading the key they already chose costs
 * nothing and covers every key they will choose next, and an unrecognised one
 * answers OTHER rather than nothing — a neutral icon, never a wrong one.
 *
 * The order is the whole content of the function, and it is the precedence
 * `routeLabels` has always applied. AIR before SEA, because that function tests
 * the air fields first and a combined key — a sea-air service — must land the
 * same way in both. RAIL before ROAD, because RAIL_HINTERLAND_TRANSIT is a rail
 * movement that also runs on a truck at one end, and the leg that names the
 * service is the rail one.
 *
 * @param {string|null} key  service_type.key
 * @returns {"SEA"|"AIR"|"RAIL"|"ROAD"|"WAREHOUSE"|"CUSTOMS"|"OTHER"}
 */
function serviceMode(key) {
  const k = String(key || "").toUpperCase();
  if (k.includes("AIR") || k.includes("FLIGHT")) return "AIR";
  if (k.includes("SEA") || k.includes("OCEAN") || k.includes("SHIPPING")) return "SEA";
  if (k.includes("RAIL")) return "RAIL";
  // INLAND is here because INLAND_TRANSPORTATION is a truck movement and was
  // landing in OTHER — so a tenant's road haulage sat under "Something else" on
  // the quote form while an empty-looking "By road or rail" card stood beside
  // it. RAIL_TRANSPORTATION is unaffected: the RAIL test above runs first.
  if (k.includes("ROAD") || k.includes("TRUCK") || k.includes("HAULAGE")
      || k.includes("INLAND") || k.includes("HINTERLAND")) return "ROAD";
  if (k.includes("WAREHOUS") || k.includes("STORAGE")) return "WAREHOUSE";
  if (k.includes("CUSTOMS") || k.includes("CLEARANCE") || k.includes("DECLARATION")) return "CUSTOMS";
  return "OTHER";
}

module.exports = { serviceMode };
