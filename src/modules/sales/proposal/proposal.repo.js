/** Proposal repository (MOD-23). Header, lines, narratives + accept→quotation. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "proposal", data);
const get = (client, id) => getById(client, "proposal", "proposal_id", id);
const insertLine = (client, data) => insertOne(client, "proposal_line", data);
const insertNarrative = (client, data) => insertOne(client, "proposal_narrative", data);
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "proposal", "proposal_id", id, fields, "*", null, { touch: "updated_at" });
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

async function byShareHash(client, hash) {
  return (await client.query(`SELECT proposal_id, doc_number, client_id, title, status, language, currency,
    service_category, incoterm, origin_location, destination_location, cargo_description,
    estimated_weight, project_cargo_flag, customs_clearance_target, transit_time_target,
    free_days_demurrage, payment_conditions, validity_days, pdf_vault_id,
    share_expires_at, share_revoked_at, viewed_at, downloaded_at
    FROM proposal WHERE share_token_hash=$1`, [hash])).rows[0] || null;
}
async function stampViewed(client,id){return (await client.query("UPDATE proposal SET viewed_at=COALESCE(viewed_at,now()) WHERE proposal_id=$1 RETURNING viewed_at",[id])).rows[0];}
async function stampDownloaded(client,id){return (await client.query("UPDATE proposal SET downloaded_at=COALESCE(downloaded_at,now()) WHERE proposal_id=$1 RETURNING downloaded_at",[id])).rows[0];}
/** Create a quotation from an accepted proposal's lines. */
async function createQuotation(client, { proposal, entityId, totalHt, docNumber }) {
  const { rows } = await client.query(
    "INSERT INTO quotation (doc_number, entity_id, client_id, dossier_id, opportunity_id, total_ht, total_ttc, status) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$6,'SENT') RETURNING quotation_id",
    [docNumber, entityId, proposal.client_id, null, proposal.opportunity_id, totalHt],
  );
  return rows[0].quotation_id;
}
module.exports = { byShareHash, stampViewed, stampDownloaded, insert, get, insertLine, insertNarrative, update, deleteLines, deleteNarratives, listLines, listNarratives, list, createQuotation };
