/** Expense-rate repository (MOD-10). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "expense_rate", data);
const get = (client, id) => getById(client, "expense_rate", "expense_rate_id", id);

async function forItem(client, dictionaryItemId) {
  const { rows } = await client.query("SELECT * FROM expense_rate WHERE dictionary_item_id = $1 ORDER BY effective_from DESC", [dictionaryItemId]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "expense_rate", "expense_rate_id", id, fields, "*", null);
}
async function remove(client, id) { await client.query("DELETE FROM expense_rate WHERE expense_rate_id = $1", [id]); }
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dictionary_item_id) { params.push(q.dictionary_item_id); wh.push("dictionary_item_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM expense_rate " + where + " ORDER BY effective_from DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, forItem, update, remove, list };
