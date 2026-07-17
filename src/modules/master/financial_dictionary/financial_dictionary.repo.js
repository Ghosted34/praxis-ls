"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const createItem = (c, d) => insertOne(c, "dictionary_item", d);
const createRule = (c, d) => insertOne(c, "posting_rule", d);
const updateItem = (c, id, patch) => updateOne(c, "dictionary_item", "dictionary_item_id", id, patch);
const getItem = (c, id) => getById(c, "dictionary_item", "dictionary_item_id", id);
async function listItems(c, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["is_active = true"];
  if (q.category) { params.push(q.category); wh.push("category = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(code ILIKE $" + params.length + " OR label_fr ILIKE $" + params.length + " OR label_en ILIKE $" + params.length + ")"); }
  const { rows } = await c.query("SELECT * FROM dictionary_item WHERE " + wh.join(" AND ") + " ORDER BY code LIMIT $1 OFFSET $2", params);
  return rows;
}
async function listRules(c, id) { const { rows } = await c.query("SELECT * FROM posting_rule WHERE dictionary_item_id = $1", [id]); return rows; }
async function deleteRules(c, id) { await c.query("DELETE FROM posting_rule WHERE dictionary_item_id = $1", [id]); }
module.exports = { createItem, createRule, updateItem, getItem, listItems, listRules, deleteRules };
