/**
 * Fleet & Warehouse.
 *
 * The utilisation tile answers as a RATIO pair, not an `active/total` shape,
 * and that is the fix the band's zero policy demands: today's client hides
 * the card when `fleet_total` is 0, which reads as "no fleet data" — the one
 * answer this product says it refuses to give by accident. The pair lets the
 * tile render "0 / 0 vehicles" as the truth ("here, nothing is on the road")
 * and reserve invisibility for the genuinely inaccessible: no MOD-39 grant,
 * or no vehicle table at all.
 *
 * PR-2 (guide §12) flips four of the five remaining tiles live. The fifth,
 * `stock_value`, STAYS HIDDEN, deliberately — see the note on its entry.
 *
 * Definitions, because a tile is a claim and each of these had to be decided:
 *
 *   fleet_docs_expiring   `vehicle_compliance` rows whose `expires_on` is
 *                         within 30 days — INCLUDING already-lapsed ones,
 *                         exactly as `/vehicle-compliance/expiring` (the
 *                         drill's source) counts them, so the tile and its
 *                         drill agree by construction. A lapsed insurance is
 *                         the most urgent row on that list, not a row that
 *                         "expired" out of the count.
 *
 *   work_orders_open      `work_order` in OPEN or IN_PROGRESS. DONE and
 *                         CANCELLED are closed; nothing else exists.
 *
 *   warehouse_occupancy   a RATIO pair: units on hand ÷ capacity units.
 *                         `warehouse_location.capacity_units` is the only
 *                         capacity the schema records (the guide's
 *                         "0100_capacity_headroom" view does not exist), and
 *                         `inventory_item.qty_on_hand` is the only occupancy.
 *                         value = round(100 × Σ qty_on_hand of non-DISPATCHED
 *                         items sitting in a location that HAS a capacity ÷
 *                         Σ capacity_units of those locations); denominator =
 *                         Σ capacity_units. So "0 % over 700 units" (empty
 *                         racks) and "0 % over 0" (no capacity recorded —
 *                         `measurable: false`, the hint line explains) stay
 *                         different statements (§6.4). Over 100 % is a real
 *                         reading (an overfilled rack), not clamped. Known
 *                         limit, stated rather than hidden: units are whatever
 *                         the tenant records — a site mixing pallets and bags
 *                         in one capacity figure gets an approximate ratio.
 */
"use strict";

const ENTRIES = [
  {
    id: "fleet_utilisation",
    domain: "fleet_warehouse",
    unit: "pair",
    module: "MOD-39",
    sourceRelation: "vehicle",
    status: "live",
    labelKey: "dash.fleetUtil",
    hintKey: "dash.fleetUtilHint",
    badgeKey: "dash.fleetBadge",
    tone: "blue",
    icon: "fleet",
    drillTo: "/fleet",
    sensitive_field: null,
  },
  {
    id: "fleet_docs_expiring",
    domain: "fleet_warehouse",
    unit: "count",
    module: "MOD-40",
    sourceRelation: "vehicle_compliance",
    status: "live",
    labelKey: "dash.fleetDocsExpiring",
    hintKey: "dash.fleetDocsExpiringHint",
    badgeKey: "dash.fleetDocsExpiringBadge",
    tone: "warn",
    icon: "compliance",
    drillTo: "/fleet/compliance",
    sensitive_field: null,
  },
  {
    id: "work_orders_open",
    domain: "fleet_warehouse",
    unit: "count",
    module: "MOD-41",
    sourceRelation: "work_order",
    status: "live",
    labelKey: "dash.workOrdersOpen",
    hintKey: "dash.workOrdersOpenHint",
    badgeKey: null,
    tone: "mute",
    icon: "clock",
    drillTo: "/fleet/work-orders",
    sensitive_field: null,
  },
  {
    id: "warehouse_occupancy",
    domain: "fleet_warehouse",
    unit: "pct",
    module: "MOD-34",
    sourceRelation: "warehouse_location",
    status: "live",
    labelKey: "dash.warehouseOccupancy",
    hintKey: "dash.warehouseOccupancyHint",
    badgeKey: null,
    tone: "orange",
    icon: "warehouse",
    drillTo: "/wms",
    sensitive_field: null,
  },
  {
    // STAYS HIDDEN IN PR-2, on purpose. A stock VALUE is Σ qty × unit cost,
    // and `inventory_item` carries no cost — no unit_cost, no valuation, no
    // link to a purchase line (`work_order_part.unit_cost` is consumption of a
    // spare, not the stock's worth). Every candidate query is a guess, and a
    // guessed money figure on the tower is the "fake number" this catalog's
    // header exists to refuse. The honest flip needs one schema addition
    // (`inventory_item.unit_cost numeric(18,2)`, or a valuation table) and
    // PR-2 ships zero migrations by the guide's parallel-safety rule (§12.3),
    // so the tile waits for a follow-up that owns that column. The entry stays
    // declared so the id, module and keys are stable for that PR.
    id: "stock_value",
    domain: "fleet_warehouse",
    unit: "money",
    module: "MOD-35",
    sourceRelation: "inventory_item",
    status: "hidden",
    labelKey: "dash.stockValue",
    hintKey: "dash.stockValueHint",
    badgeKey: null,
    tone: "blue",
    icon: "stock",
    drillTo: "/wms/inventory",
    sensitive_field: null,
  },
];

async function values(client, { count, ratio }) {
  const out = {};
  out.fleet_utilisation = await ratio(
    client,
    "SELECT count(*) FILTER (WHERE status='ACTIVE') AS value, count(*) AS denominator FROM vehicle",
  );
  out.fleet_docs_expiring = await count(
    client,
    "SELECT count(*) n FROM vehicle_compliance " +
      "WHERE expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + 30",
  );
  out.work_orders_open = await count(
    client,
    "SELECT count(*) n FROM work_order WHERE status IN ('OPEN','IN_PROGRESS')",
  );
  // NULLIF keeps the division honest: over zero capacity the value is SQL
  // NULL, which `ratio()` reports as 0 with denominator 0 — unmeasurable, not
  // "empty". No COALESCE on the capacity sum for the same reason.
  out.warehouse_occupancy = await ratio(
    client,
    "SELECT round(100.0 * COALESCE(SUM(i.qty_on_hand), 0) / NULLIF(SUM(l.capacity_units), 0)) AS value, " +
      "SUM(l.capacity_units) AS denominator " +
      "FROM warehouse_location l " +
      "LEFT JOIN LATERAL (" +
      "SELECT SUM(qty_on_hand) AS qty_on_hand FROM inventory_item " +
      "WHERE location_id = l.location_id AND state <> 'DISPATCHED'" +
      ") i ON true " +
      "WHERE l.capacity_units IS NOT NULL AND l.capacity_units > 0",
  );
  return out;
}

module.exports = { ENTRIES, values };
