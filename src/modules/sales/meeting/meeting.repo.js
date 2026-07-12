"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "meeting", data);
const get = (client, id) => getById(client, "meeting", "meeting_id", id);
const insertNote = (client, data) => insertOne(client, "meeting_note", data);
async function listNotes(client, id) { return (await client.query("SELECT * FROM meeting_note WHERE meeting_id = $1 ORDER BY created_at", [id])).rows; }
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.lead_id) { params.push(q.lead_id); wh.push("lead_id = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM meeting " + where + " ORDER BY scheduled_at DESC NULLS LAST, created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}
module.exports = { insert, get, insertNote, listNotes, list };
