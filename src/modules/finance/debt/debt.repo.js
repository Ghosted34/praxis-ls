/** Debt repository (MOD-53). Engagements + repayments. All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertEngagement = (client, data) => insertOne(client, "debt_engagement", data);
const getEngagement = (client, id) => getById(client, "debt_engagement", "debt_engagement_id", id);
const insertRepayment = (client, data) => insertOne(client, "debt_repayment", data);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return getEngagement(client, id);
  return updateOne(client, "debt_engagement", "debt_engagement_id", id, fields, "*", null);
}
async function listRepayments(client, id) {
  const { rows } = await client.query("SELECT * FROM debt_repayment WHERE debt_engagement_id = $1 ORDER BY paid_on", [id]);
  return rows;
}
async function repaidTotals(client, id) {
  const { rows } = await client.query("SELECT COALESCE(SUM(principal_part),0) AS principal, COALESCE(SUM(interest_part),0) AS interest FROM debt_repayment WHERE debt_engagement_id = $1", [id]);
  return { principal: Number(rows[0].principal), interest: Number(rows[0].interest) };
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM debt_engagement " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
async function remove(client, id) {
  const { rowCount } = await client.query("DELETE FROM debt_engagement WHERE debt_engagement_id = $1", [id]);
  return rowCount > 0;
}
module.exports = { insertEngagement, getEngagement, insertRepayment, update, remove, listRepayments, repaidTotals, list };
