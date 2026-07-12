"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "marketing_campaign", data);
const get = (client, id) => getById(client, "marketing_campaign", "campaign_id", id);
async function update(client, id, fields) {
  const keys = Object.keys(fields); const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return (await client.query("UPDATE marketing_campaign SET " + set + " WHERE campaign_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])])).rows[0] || null;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM marketing_campaign " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}
async function subscribe(client, { email, name, source }) {
  return (await client.query(
    "INSERT INTO newsletter_subscriber (email, name, source, is_subscribed) VALUES ($1,$2,$3,true) " +
      "ON CONFLICT (email) DO UPDATE SET is_subscribed = true, name = COALESCE(EXCLUDED.name, newsletter_subscriber.name) RETURNING *",
    [email, name || null, source || "website"])).rows[0];
}
async function unsubscribe(client, email) {
  return (await client.query("UPDATE newsletter_subscriber SET is_subscribed = false WHERE email = $1 RETURNING *", [email])).rows[0] || null;
}
async function listSubscribers(client, q = {}) {
  const { limit, offset } = page(q);
  return (await client.query("SELECT * FROM newsletter_subscriber WHERE is_subscribed = true ORDER BY subscribed_at DESC LIMIT $1 OFFSET $2", [limit, offset])).rows;
}
module.exports = { insert, get, update, list, subscribe, unsubscribe, listSubscribers };
