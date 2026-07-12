/**
 * Warehouse location repository (MOD-34). Physical slots (zone/aisle/rack/bin or
 * yard). Adds occupancy counts (inventory + equipment placed here) and the
 * reference count that guards deletion of an occupied location.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "warehouse_location", data);
const findById = (client, id) => getById(client, "warehouse_location", "location_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE warehouse_location SET " + set + " WHERE location_id = $1 RETURNING *",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.zone) { params.push(q.zone); wh.push("zone = $" + params.length); }
  if (q.yard) { wh.push("yard IS NOT NULL"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT * FROM warehouse_location ${where} ORDER BY zone NULLS FIRST, aisle, rack, bin LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

const REFERENCING = [
  ["inventory_item", "location_id", "stock items"],
  ["wms_equipment", "location_id", "equipment"],
  ["grn_inbound", "putaway_location", "GRNs"],
];

async function occupancy(client, id) {
  const breakdown = {};
  let total = 0;
  for (const [table, col, label] of REFERENCING) {
    try {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [id]);
      const n = rows[0] ? rows[0].n : 0;
      if (n > 0) { breakdown[label] = n; total += n; }
    } catch (err) {
      if (err && err.code === "42P01") continue;
      throw err;
    }
  }
  return { total, breakdown };
}

module.exports = { insert, findById, update, list, occupancy };
