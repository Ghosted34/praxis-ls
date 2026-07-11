/** Cost tracking repository (MOD-47). cost_entry + budget/actual SQL lives here. */
"use strict";
const { insertOne, page } = require("../../../shared/db/query-helpers");

const insertCostEntry = (client, data) => insertOne(client, "cost_entry", data);

async function purchaseRuleAccount(client, dictionaryItemId) {
  if (!dictionaryItemId) return null;
  const { rows } = await client.query(
    "SELECT debit_account FROM posting_rule WHERE dictionary_item_id = $1 AND applies_context = 'purchase' ORDER BY created_at ASC LIMIT 1",
    [dictionaryItemId],
  );
  return rows[0] ? rows[0].debit_account : null;
}

async function actualTotal(client, dossierId) {
  const { rows } = await client.query("SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entry WHERE dossier_id = $1", [dossierId]);
  return Number(rows[0].total);
}

async function approvedBudgetTotal(client, dossierId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS total FROM costing_line cl " +
      "JOIN costing c ON c.costing_id = cl.costing_id WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'",
    [dossierId],
  );
  return Number(rows[0].total);
}

async function listByDossier(client, dossierId, q = {}) {
  const { limit, offset } = page(q);
  const { rows } = await client.query(
    "SELECT * FROM cost_entry WHERE dossier_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    [dossierId, limit, offset],
  );
  return rows;
}

module.exports = { insertCostEntry, purchaseRuleAccount, actualTotal, approvedBudgetTotal, listByDossier };
