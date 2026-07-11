/**
 * Vehicle registry repository (MOD-39). All vehicle SQL. Adds filtered listing,
 * an entity/asset join, and the open-commitment counts (dispatch/work orders)
 * that gate disposal.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "vehicle", data);
const findById = (client, id) => getById(client, "vehicle", "vehicle_id", id);

async function get(client, id) {
  const { rows } = await client.query(
    `SELECT v.*, ce.name AS entity_name
       FROM vehicle v
       LEFT JOIN corporate_entity ce ON ce.entity_id = v.entity_id
      WHERE v.vehicle_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE vehicle SET " + set + " WHERE vehicle_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("v.entity_id = $" + params.length); }
  if (q.category) { params.push(q.category); wh.push("v.category = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("v.status = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("v.registration ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT v.*, ce.name AS entity_name
       FROM vehicle v
       LEFT JOIN corporate_entity ce ON ce.entity_id = v.entity_id
       ${where}
      ORDER BY v.registration ASC
      LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/** Open commitments that must clear before a vehicle can be disposed. */
async function openCommitments(client, id) {
  const dispatch = await client.query(
    "SELECT count(*)::int AS n FROM fleet_dispatch WHERE vehicle_id = $1 AND status IN ('ASSIGNED','OUT')",
    [id],
  ).then((r) => r.rows[0].n).catch(() => 0);
  const workOrders = await client.query(
    "SELECT count(*)::int AS n FROM work_order WHERE vehicle_id = $1 AND status IN ('OPEN','IN_PROGRESS')",
    [id],
  ).then((r) => r.rows[0].n).catch(() => 0);
  return { dispatch, workOrders, total: dispatch + workOrders };
}

module.exports = { insert, findById, get, update, list, openCommitments };
