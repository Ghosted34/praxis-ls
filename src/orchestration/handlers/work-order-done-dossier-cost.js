/**
 * work_order DONE → dossier maintenance cost (Plan A; fixes a deferred item).
 *
 * A completed work order that's tagged to a dossier carries a `cost`; attribute it
 * to the dossier's actual cost. Links to the work order's GL `entry_id` when it has
 * one (no re-post); otherwise records it analytically (entry_id NULL) for margin.
 * IDEMPOTENT on cost_entry.source_ref = 'work_order:<id>'.
 */
"use strict";

const costRepo = require("../../modules/costing/cost_tracking/cost_tracking.repo");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "work_order.status_changed",
  handlerKey: "work_order.done:dossier-cost",
  feature: null,
  async run(client, event) {
    const id = idFromRef(event.entity_ref, "work_order");
    if (!id) return { skipped: "no work_order ref" };

    const r = await client.query("SELECT status, dossier_id, cost, entry_id FROM work_order WHERE work_order_id = $1", [id]);
    const wo = r.rows[0];
    if (!wo) return { skipped: "not found" };
    if (wo.status !== "DONE") return { skipped: "not done" };
    if (!wo.dossier_id) return { skipped: "not tagged to a dossier" };

    const amount = Number(wo.cost || 0);
    if (!(amount > 0)) return { skipped: "no cost" };

    const sourceRef = "work_order:" + id;
    const exists = await client.query("SELECT 1 FROM cost_entry WHERE source_ref = $1 LIMIT 1", [sourceRef]);
    if (exists.rows.length) return { skipped: "already attributed" };

    const ce = await costRepo.insertCostEntry(client, {
      dossier_id: wo.dossier_id,
      dictionary_item_id: null,
      category: "maintenance",
      amount,
      entry_id: wo.entry_id || null,
      proof_vault_id: null,
      source_ref: sourceRef,
    });
    return { created: true, amount, cost_entry_id: ce.cost_entry_id };
  },
};
