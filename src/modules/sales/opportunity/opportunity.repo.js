/** Opportunity / pipeline repository (MOD-24). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");
const insert = (client, data) => insertOne(client, "opportunity", data);
const get = (client, id) => getById(client, "opportunity", "opportunity_id", id);
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "opportunity", "opportunity_id", id, fields, "*", null, { touch: "updated_at" });
}
const stage = (client, id) => getById(client, "pipeline_stage", "pipeline_stage_id", id);
async function listStages(client) {
  const { rows } = await client.query("SELECT * FROM pipeline_stage ORDER BY sort_order");
  return rows;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.status) { params.push(q.status); wh.push("o.status = $" + params.length); }
  if (q.pipeline_stage_id) { params.push(q.pipeline_stage_id); wh.push("o.pipeline_stage_id = $" + params.length); }
  if (q.owner_user_id) { params.push(q.owner_user_id); wh.push("o.owner_user_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("o.name ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT o.*, s.name AS stage_name, s.code AS stage_code FROM opportunity o LEFT JOIN pipeline_stage s ON s.pipeline_stage_id = o.pipeline_stage_id " +
      where + " ORDER BY o.created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
/** Kanban: open opportunities grouped by stage with weighted value. */
async function board(client) {
  const { rows } = await client.query(
    "SELECT s.pipeline_stage_id, s.name AS stage_name, s.sort_order, COUNT(o.opportunity_id)::int AS count, " +
      "COALESCE(SUM(o.estimated_value),0) AS value, COALESCE(SUM(o.estimated_value * COALESCE(o.probability,0)/100.0),0) AS weighted_value " +
      "FROM pipeline_stage s LEFT JOIN opportunity o ON o.pipeline_stage_id = s.pipeline_stage_id AND o.status = 'OPEN' " +
      "GROUP BY s.pipeline_stage_id, s.name, s.sort_order ORDER BY s.sort_order");
  return rows.map((r) => ({ pipeline_stage_id: r.pipeline_stage_id, stage_name: r.stage_name, count: r.count, value: Number(r.value), weighted_value: Math.round(Number(r.weighted_value) * 100) / 100 }));
}
module.exports = { insert, get, update, stage, listStages, list, board };
