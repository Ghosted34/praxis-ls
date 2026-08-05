"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "success_story", data);
const get = (client, id) => getById(client, "success_story", "success_story_id", id);
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  return updateOne(client, "success_story", "success_story_id", id, fields, "*", null);
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.published_only === "true" || q.published_only === true) wh.push("is_published = true");
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM success_story " + where + " ORDER BY COALESCE(published_at, created_at) DESC LIMIT $1 OFFSET $2", params)).rows;
}
module.exports = { insert, get, update, list };
