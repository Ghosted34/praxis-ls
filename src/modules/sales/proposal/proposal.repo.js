/** Proposal repository (MOD-23). Header, lines, narratives + accept→quotation. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "proposal", data);
const get = (client, id) => getById(client, "proposal", "proposal_id", id);
const insertLine = (client, data) => insertOne(client, "proposal_line", data);
const insertNarrative = (client, data) => insertOne(client, "proposal_narrative", data);
async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE proposal SET " + set + ", updated_at = now() WHERE proposal_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function deleteLines(client, id) { await client.query("DELETE FROM proposal_line WHERE proposal_id = $1", [id]); }
async function deleteNarratives(client, id) { await client.query("DELETE FROM proposal_narrative WHERE proposal_id = $1", [id]); }
async function listLines(client, id) { return (await client.query("SELECT * FROM proposal_line WHERE proposal_id = $1 ORDER BY proposal_line_id", [id])).rows; }
async function listNarratives(client, id) { return (await client.query("SELECT * FROM proposal_narrative WHERE proposal_id = $1 ORDER BY sort_order", [id])).rows; }
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM proposal " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
/** Create a quotation from an accepted proposal's lines. */
async function createQuotation(client, { proposal, entityId, totalHt, docNumber }) {
  const { rows } = await client.query(
    "INSERT INTO quotation (doc_number, entity_id, client_id, dossier_id, opportunity_id, total_ht, total_ttc, status) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$6,'SENT') RETURNING quotation_id",
    [docNumber, entityId, proposal.client_id, null, proposal.opportunity_id, totalHt],
  );
  return rows[0].quotation_id;
}
module.exports = { insert, get, insertLine, insertNarrative, update, deleteLines, deleteNarratives, listLines, listNarratives, list, createQuotation };
