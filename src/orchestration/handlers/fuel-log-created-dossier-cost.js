/**
 * fuel_log.created → dossier fuel cost (Plan A, Phase 2, KB §8.7).
 *
 * A fuel fill does NOT post to the ledger itself. When it's tagged to a dossier,
 * this posts the actual cost via cost_tracking.recordCost — which writes BOTH the
 * GL entry (Dr fuel expense, Cr treasury) and the dossier `cost_entry` atomically.
 *
 * Graceful degrade (per the fuel_log contract): only posts once a fuel-expense
 * account is configured in Settings (`finance.fuel_expense_account`); otherwise
 * skips, leaving the fill recorded without a wrong entry. IDEMPOTENT via the
 * journal entry's source_doc_ref (`fuel_log:<id>`).
 */
"use strict";

const costTracking = require("../../modules/costing/cost_tracking/cost_tracking.service");
const { getSetting } = require("../../shared/config/settings");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "fuel_log.created",
  handlerKey: "fuel_log.created:dossier-cost",
  feature: null,
  async run(client, event) {
    const payload = event.payload || {};
    const dossierId = payload.dossier_id || null;
    const cost = Number(payload.cost || 0);
    const fuelLogId = idFromRef(event.entity_ref, "fuel_log");
    if (!dossierId || !(cost > 0)) return { skipped: "no dossier or cost" };

    const d = await client.query("SELECT entity_id FROM dossier WHERE dossier_id = $1", [dossierId]);
    const entityId = d.rows[0] && d.rows[0].entity_id;
    if (!entityId) return { skipped: "dossier has no entity" };

    // Fuel expense account is a tenant setting (accounts are data, never literals).
    const setting = await getSetting(client, "finance", "fuel_expense_account", null);
    const expenseCoa = typeof setting === "string" ? setting : (setting && (setting.account || setting.code)) || null;
    if (!expenseCoa) return { skipped: "no finance.fuel_expense_account configured" };

    const sourceDocRef = "fuel_log:" + fuelLogId;
    const exists = await client.query("SELECT 1 FROM journal_entry WHERE source_doc_ref = $1 LIMIT 1", [sourceDocRef]);
    if (exists.rows.length) return { skipped: "already posted" };

    const res = await costTracking.recordCost(client, {
      dossierId,
      amount: cost,
      isDisbursement: false,
      expenseCoa,
      entityId,
      entryDate: new Date().toISOString().slice(0, 10),
      sourceDocRef,
      category: "fuel",
      actor: { user_id: null },
    });
    return { created: true, cost_entry_id: res.cost_entry.cost_entry_id };
  },
};
