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
    status: "hidden",
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
    status: "hidden",
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
    status: "hidden",
    labelKey: "dash.warehouseOccupancy",
    hintKey: "dash.warehouseOccupancyHint",
    badgeKey: null,
    tone: "orange",
    icon: "warehouse",
    drillTo: "/wms",
    sensitive_field: null,
  },
  {
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

async function values(client, { ratio }) {
  const out = {};
  out.fleet_utilisation = await ratio(
    client,
    "SELECT count(*) FILTER (WHERE status='ACTIVE') AS value, count(*) AS denominator FROM vehicle",
  );
  return out;
}

module.exports = { ENTRIES, values };
