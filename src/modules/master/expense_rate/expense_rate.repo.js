/** Expense-rate repository (MOD-10). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const WRITABLE = ["dictionary_item_id", "rate_provider_id", "container_type_ref_id", "rate", "currency", "effective_from", "effective_to", "provider_kind", "provider_supplier_id", "note"];

const insert = (client, data) => insertOne(client, "expense_rate", data, "*", WRITABLE);
const get = (client, id) => getById(client, "expense_rate", "expense_rate_id", id);

// Joined with rate_provider + the container-type dictionary_ref row so every
// caller gets display-ready names without a second round trip.
const SELECT = `
  SELECT er.*, rp.kind AS provider_kind_resolved, rp.name AS provider_name,
         ct.code AS container_type_code, COALESCE(ct.name_en, ct.name_fr) AS container_type_name
    FROM expense_rate er
    LEFT JOIN rate_provider rp ON rp.rate_provider_id = er.rate_provider_id
    LEFT JOIN dictionary_ref ct ON ct.ref_id = er.container_type_ref_id`;

async function forItem(client, dictionaryItemId) {
  const { rows } = await client.query(`${SELECT} WHERE er.dictionary_item_id = $1 ORDER BY er.effective_from DESC`, [dictionaryItemId]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "expense_rate", "expense_rate_id", id, fields, "*", WRITABLE);
}
async function remove(client, id) { await client.query("DELETE FROM expense_rate WHERE expense_rate_id = $1", [id]); }
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dictionary_item_id) { params.push(q.dictionary_item_id); wh.push("er.dictionary_item_id = $" + params.length); }
  if (q.rate_provider_id) { params.push(q.rate_provider_id); wh.push("er.rate_provider_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(`${SELECT} ${where} ORDER BY er.effective_from DESC LIMIT $1 OFFSET $2`, params);
  return rows;
}
// ── G7 import lookups — the tenant's real values for the template reference
// sheet and the validate/commit resolution. All rows are small registers; a
// per-row lookup would be 400 queries, these are one each. ────────────────

async function listDictionaryItems(c) {
  const { rows } = await c.query(
    "SELECT dictionary_item_id, code, name_en, name_fr FROM dictionary_item WHERE is_active ORDER BY name_en, name_fr",
  );
  return rows;
}

async function listProviders(c) {
  const { rows } = await c.query(
    "SELECT rate_provider_id, code, name FROM rate_provider WHERE is_active ORDER BY name",
  );
  return rows;
}

async function listContainerTypes(c) {
  const { rows } = await c.query(
    "SELECT ref_id, code, name_en, name_fr FROM dictionary_ref WHERE kind = 'CONTAINER_TYPE' AND is_active ORDER BY code",
  );
  return rows;
}

module.exports = { insert, get, forItem, update, remove, list, listDictionaryItems, listProviders, listContainerTypes };
