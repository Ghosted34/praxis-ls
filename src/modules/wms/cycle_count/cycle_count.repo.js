/**
 * Cycle count repository (MOD-38). Stock audits per location. Joins the location
 * for context and filters by location.
 */
"use strict";
const { insertOne, getById, page, updateOne, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "cycle_count", data);
const findById = (client, id) => getById(client, "cycle_count", "cycle_count_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return findById(client, id);
  return updateOne(client, "cycle_count", "cycle_count_id", id, fields, "*", null);
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.location_id) { params.push(q.location_id); wh.push("cc.location_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT cc.*, wl.zone, wl.aisle, wl.rack, wl.bin, ${TOTAL_COL}
       FROM cycle_count cc
       LEFT JOIN warehouse_location wl ON wl.location_id = cc.location_id
       ${where}
      ORDER BY cc.created_at DESC, cc.cycle_count_id
      LIMIT $1 OFFSET $2`,
    params,
  );
  const split = splitTotal(rows);
  // The match count, for the shared controller's `meta.total` (see service.list).
  Object.defineProperty(split.rows, "_total", { value: split.total, enumerable: false });
  Object.defineProperty(split.rows, "_page", { value: { limit, offset }, enumerable: false });
  return split.rows;
}

module.exports = { insert, findById, update, list };
