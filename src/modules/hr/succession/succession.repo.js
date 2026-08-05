/**
 * Succession plan repository (MOD-19). Role → incumbent/successor with a
 * readiness horizon. list() resolves the two employee FKs to names so the
 * board can render without a second round-trip.
 */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "succession_plan", data);
const findById = (client, id) => getById(client, "succession_plan", "succession_plan_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return findById(client, id);
  return updateOne(client, "succession_plan", "succession_plan_id", id, fields, "*", null);
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.q) { params.push("%" + q.q + "%"); wh.push("sp.role_title ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT sp.*, inc.full_name AS incumbent_name, suc.full_name AS successor_name
       FROM succession_plan sp
       LEFT JOIN employee inc ON inc.employee_id = sp.incumbent_id
       LEFT JOIN employee suc ON suc.employee_id = sp.successor_id
       ${where}
      ORDER BY sp.role_title ASC LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

module.exports = { insert, findById, update, list };
