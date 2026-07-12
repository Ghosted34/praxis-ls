"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");
const insertEnquiry = (client, data) => insertOne(client, "contact_enquiry", data);
const getEnquiry = (client, id) => getById(client, "contact_enquiry", "contact_enquiry_id", id);
const insertPartnership = (client, data) => insertOne(client, "partnership_request", data);
const getPartnership = (client, id) => getById(client, "partnership_request", "partnership_request_id", id);
async function updEnquiry(client, id, fields) {
  const keys = Object.keys(fields); const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return (await client.query("UPDATE contact_enquiry SET " + set + " WHERE contact_enquiry_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])])).rows[0] || null;
}
async function updPartnership(client, id, fields) {
  const keys = Object.keys(fields); const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  return (await client.query("UPDATE partnership_request SET " + set + " WHERE partnership_request_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])])).rows[0] || null;
}
async function listEnquiries(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM contact_enquiry " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}
async function listPartnerships(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM partnership_request " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}
module.exports = { insertEnquiry, getEnquiry, insertPartnership, getPartnership, updEnquiry, updPartnership, listEnquiries, listPartnerships };
