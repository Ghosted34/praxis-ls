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
// All active recipients (no pagination) — for a campaign send fan-out.
const listActiveSubscriberEmails = (client) =>
  client.query("SELECT email, name FROM newsletter_subscriber WHERE is_subscribed = true").then((r) => r.rows);

// --- Sending identities (campaign_sender) + email templates (campaign_template), MOD-22 ---
const listSenders = (client) => client.query("SELECT * FROM campaign_sender ORDER BY created_at DESC").then((r) => r.rows);
const getSender = (client, id) => getById(client, "campaign_sender", "sender_id", id);
const insertSender = (client, data) => insertOne(client, "campaign_sender", data);
async function verifySender(client, id) {
  return (await client.query("UPDATE campaign_sender SET verified_at = now() WHERE sender_id = $1 RETURNING *", [id])).rows[0] || null;
}
async function deleteSender(client, id) {
  return (await client.query("DELETE FROM campaign_sender WHERE sender_id = $1 RETURNING *", [id])).rows[0] || null;
}

const listTemplates = (client) => client.query("SELECT * FROM campaign_template ORDER BY updated_at DESC").then((r) => r.rows);
const getTemplate = (client, id) => getById(client, "campaign_template", "template_id", id);
const insertTemplate = (client, data) => insertOne(client, "campaign_template", data);
async function updateTemplate(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getById(client, "campaign_template", "template_id", id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return (await client.query("UPDATE campaign_template SET " + set + ", updated_at = now() WHERE template_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])])).rows[0] || null;
}
async function deleteTemplate(client, id) {
  return (await client.query("DELETE FROM campaign_template WHERE template_id = $1 RETURNING *", [id])).rows[0] || null;
}

module.exports = {
  insert, get, update, list, subscribe, unsubscribe, listSubscribers, listActiveSubscriberEmails,
  listSenders, getSender, insertSender, verifySender, deleteSender,
  listTemplates, getTemplate, insertTemplate, updateTemplate, deleteTemplate,
};
