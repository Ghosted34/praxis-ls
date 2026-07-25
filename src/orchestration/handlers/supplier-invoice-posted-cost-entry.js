/**
 * supplier_invoice.posted → dossier cost_entry (Plan A, Phase 1).
 *
 * A posted supplier invoice ALREADY wrote its GL journal entry (Dr expense/VAT,
 * Cr supplier) and stored `entry_id` + `dossier_id`. The dossier's actual cost is
 * read from `cost_entry`, which procurement doesn't populate — so this reflects
 * the procurement cost onto the dossier by inserting a `cost_entry` LINKED to the
 * existing GL entry. It does NOT re-post to the ledger (that would double-count).
 *
 * Amount = HT (VAT is recoverable, not a cost). IDEMPOTENT on the GL entry_id.
 * Untagged procurement (no dossier_id) is skipped — nothing to attribute.
 */
"use strict";

const costRepo = require("../../modules/costing/cost_tracking/cost_tracking.repo");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "supplier_invoice.posted",
  handlerKey: "supplier_invoice.posted:cost-entry",
  feature: null,
  async run(client, event) {
    const siId = idFromRef(event.entity_ref, "supplier_invoice");
    if (!siId) return { skipped: "no supplier_invoice ref" };

    const { rows } = await client.query(
      "SELECT dossier_id, entry_id, amount_ht, amount_ttc FROM supplier_invoice WHERE supplier_invoice_id = $1",
      [siId],
    );
    const si = rows[0];
    if (!si) return { skipped: "not found" };
    if (!si.dossier_id) return { skipped: "not tagged to a dossier" };
    if (!si.entry_id) return { skipped: "not posted (no GL entry)" };

    // Idempotency: a cost_entry already linked to this GL entry?
    const exists = await client.query("SELECT 1 FROM cost_entry WHERE entry_id = $1 LIMIT 1", [si.entry_id]);
    if (exists.rows.length) return { skipped: "cost_entry already linked" };

    const amount = Number(si.amount_ht || si.amount_ttc || 0);
    if (!(amount > 0)) return { skipped: "no amount" };

    const ce = await costRepo.insertCostEntry(client, {
      dossier_id: si.dossier_id,
      dictionary_item_id: null,
      category: "procurement",
      amount,
      entry_id: si.entry_id,
      proof_vault_id: null,
    });
    return { created: true, cost_entry_id: ce.cost_entry_id };
  },
};
