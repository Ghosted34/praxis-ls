"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const insertEnquiry = (client, data) => insertOne(client, "contact_enquiry", data);
const getEnquiry = (client, id) => getById(client, "contact_enquiry", "contact_enquiry_id", id);
const insertPartnership = (client, data) => insertOne(client, "partnership_request", data);
const getPartnership = (client, id) => getById(client, "partnership_request", "partnership_request_id", id);
// PERF S19/S20: were hand-rolled SET builders, which bypassed the identifier
// validation and writable allow-list in query-helpers.
async function updEnquiry(client, id, fields) {
  return updateOne(client, "contact_enquiry", "contact_enquiry_id", id, fields, "*", null);
}
async function updPartnership(client, id, fields) {
  return updateOne(client, "partnership_request", "partnership_request_id", id, fields, "*", null);
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
