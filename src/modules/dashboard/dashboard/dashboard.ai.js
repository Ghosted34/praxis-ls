/**
 * AI action manifest (AI_ARCHITECTURE §2) for the tenant dashboard (MOD-00A).
 *
 * "How are we doing" and "what is moving right now" are the two questions a
 * copilot is asked before any other, and the KPI band and the control tower are
 * where the app already answers them. Reads only — a dashboard computes, it
 * does not hold anything to write.
 *
 * `control_tower`'s options go through `service.controlTowerOptions`, the SAME
 * sanitiser the HTTP controller uses: mode, layer, verification and date field
 * end up in a SQL predicate, and an unrecognised value has to mean "no filter"
 * on this path exactly as it does on that one.
 *
 * `kpiBand` and `kpiCatalogPayload` are absent: both take a `ctx` carrying the
 * caller's scope closure, which `requirePermission` derives over HTTP and an AI
 * tool call never passes through — the same boundary documented in
 * `dashboard/workspace/workspace.ai.js`. Supplying a scope here would be
 * inventing authority; `kpis` carries no such parameter.
 */
"use strict";

const service = require("./dashboard.service");

const MOD = "MOD-00A";

module.exports = {
  entity: "dashboard",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "tenant_kpis", service: (c) => service.kpis(c), permission: { module: MOD, action: "view" }, describe: "The tenant's headline KPIs — the numbers the dashboard opens on." },
    { key: "control_tower", service: (c, p) => service.controlTower(c, service.controlTowerOptions(p || {})), permission: { module: MOD, action: "view" }, describe: "Operations files in flight. Filter by mode (AIR/SEA/LAND/RAIL/OTHER), layer (MOVEMENT/ACTIVITY), verified (VERIFIED/UNVERIFIED), service_type_id, territory and a date window on date_field (created/updated/arrival/delivery)." },
  ],

  writes: [],
};
