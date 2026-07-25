/**
 * outbound DISPATCHED → dossier warehouse handling cost (Plan A; fixes a deferred item).
 *
 * WMS outbound has no cost field, so handling cost is derived from a tenant rate:
 * `wms.handling_rate = { flat?, per_unit? }`. On dispatch of a dossier-tagged
 * outbound order, cost = flat + per_unit × total picked units, recorded as an
 * ANALYTICAL cost_entry tagged to the dossier (no GL posting — WMS handling isn't
 * a separate cash outflow here). OPT-IN: inert unless the rate is configured.
 * IDEMPOTENT on cost_entry.source_ref = 'outbound_order:<id>'.
 */
"use strict";

const costRepo = require("../../modules/costing/cost_tracking/cost_tracking.repo");
const { getSetting } = require("../../shared/config/settings");

const round2 = (n) => Math.round(Number(n) * 100) / 100;
function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "outbound.status_changed",
  handlerKey: "outbound.dispatched:handling-cost",
  feature: null,
  async run(client, event) {
    const id = idFromRef(event.entity_ref, "outbound");
    if (!id) return { skipped: "no outbound ref" };

    const r = await client.query("SELECT status, dossier_id FROM outbound_order WHERE outbound_order_id = $1", [id]);
    const ob = r.rows[0];
    if (!ob) return { skipped: "not found" };
    if (ob.status !== "DISPATCHED") return { skipped: "not dispatched" };
    if (!ob.dossier_id) return { skipped: "not tagged to a dossier" };

    const cfg = await getSetting(client, "wms", "handling_rate", null);
    if (!cfg || typeof cfg !== "object") return { skipped: "no wms.handling_rate configured" };
    const flat = Number(cfg.flat || 0);
    const perUnit = Number(cfg.per_unit || 0);

    let amount = flat;
    if (perUnit > 0) {
      const q = await client.query("SELECT COALESCE(SUM(qty), 0) AS units FROM outbound_line WHERE outbound_order_id = $1", [id]);
      amount += perUnit * Number(q.rows[0].units || 0);
    }
    amount = round2(amount);
    if (!(amount > 0)) return { skipped: "computed handling cost is zero" };

    const sourceRef = "outbound_order:" + id;
    const exists = await client.query("SELECT 1 FROM cost_entry WHERE source_ref = $1 LIMIT 1", [sourceRef]);
    if (exists.rows.length) return { skipped: "already attributed" };

    const ce = await costRepo.insertCostEntry(client, {
      dossier_id: ob.dossier_id,
      dictionary_item_id: null,
      category: "handling",
      amount,
      entry_id: null,
      proof_vault_id: null,
      source_ref: sourceRef,
    });
    return { created: true, amount, cost_entry_id: ce.cost_entry_id };
  },
};
