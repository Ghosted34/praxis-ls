"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "success_story", data);
const get = (client, id) => getById(client, "success_story", "success_story_id", id);
async function update(client, id, fields) {
  const keys = Object.keys(fields); const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return (await client.query("UPDATE success_story SET " + set + " WHERE success_story_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])])).rows[0] || null;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.published_only === "true" || q.published_only === true) wh.push("is_published = true");
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM success_story " + where + " ORDER BY COALESCE(published_at, created_at) DESC LIMIT $1 OFFSET $2", params)).rows;
}
module.exports = { insert, get, update, list };
