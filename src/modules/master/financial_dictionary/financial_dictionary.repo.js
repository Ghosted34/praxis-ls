"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const createItem = (c, d) => insertOne(c, "dictionary_item", d);
const createRule = (c, d) => insertOne(c, "posting_rule", d);
const updateItem = (c, id, patch) => updateOne(c, "dictionary_item", "dictionary_item_id", id, patch);
const getItem = (c, id) => getById(c, "dictionary_item", "dictionary_item_id", id);
async function listItems(c, q = {}) { const { limit, offset } = page(q); const { rows } = await c.query("SELECT * FROM dictionary_item WHERE is_active = true ORDER BY code LIMIT $1 OFFSET $2", [limit, offset]); return rows; }
async function listRules(c, id) { const { rows } = await c.query("SELECT * FROM posting_rule WHERE dictionary_item_id = $1", [id]); return rows; }
module.exports = { createItem, createRule, updateItem, getItem, listItems, listRules };
