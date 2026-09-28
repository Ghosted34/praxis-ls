/**
 * Warehouse location repository (MOD-34). Physical slots (zone/aisle/rack/bin or
 * yard). Adds occupancy counts (inventory + equipment placed here) and the
 * reference count that guards deletion of an occupied location.
 */
"use strict";
const { insertOne, getById, page, updateOne, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");
const { LABEL_SQL } = require("./warehouse_location.rules");

const insert = (client, data) => insertOne(client, "warehouse_location", data);
const findById = (client, id) => getById(client, "warehouse_location", "location_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return findById(client, id);
  return updateOne(client, "warehouse_location", "location_id", id, fields, "*", null);
}

/**
 * One page of slots, with the true total and a search.
 *
 * The Locations screen used to read this with no search and no total — the
 * first 50 slots in slot order — and filter THOSE in the browser, so a
 * warehouse with more than 50 slots could neither see nor find the rest.
 * `?q=` now matches the label the list shows (`LABEL_SQL`, the SQL twin of
 * `label()`), server-side, and the total rides on `meta.total` so the screen
 * can page. `location_id` is the tie-break a stable page needs: slots that
 * share zone/aisle/rack/bin (or have none) must not trade places between pages.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.zone) { params.push(q.zone); wh.push("zone = $" + params.length); }
  if (q.yard) { wh.push("yard IS NOT NULL"); }
  if (q.q && String(q.q).trim()) {
    params.push("%" + String(q.q).trim() + "%");
    wh.push(`(${LABEL_SQL}) ILIKE $${params.length}`);
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT *, ${TOTAL_COL} FROM warehouse_location ${where}
      ORDER BY zone NULLS FIRST, aisle, rack, bin, location_id LIMIT $1 OFFSET $2`,
    params,
  );
  const split = splitTotal(rows);
  // Read by the shared controller as `meta.total` (resource.js makeController).
  Object.defineProperty(split.rows, "_total", { value: split.total, enumerable: false });
  Object.defineProperty(split.rows, "_page", { value: { limit, offset }, enumerable: false });
  return split.rows;
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

/**
 * What one slot holds, counted in SQL — the location 360's tiles.
 *
 * The screen used to fetch the tenant's inventory, equipment and cycle counts
 * (the first 50 of each, the list default) and filter them by location in the
 * browser, so a warehouse past 50 stock lines under-counted every slot and
 * showed an empty one as empty when its stock was simply on page two. These
 * are the counts over EVERY row for this location, and `on_hand` is the sum
 * of its quantities that "Capacity used" is worked out from.
 *
 * Same missing-table tolerance as `occupancy`, for a tenant provisioned
 * before a WMS table existed.
 */
const STATS = [
  ["items", "SELECT count(*)::int AS items FROM inventory_item WHERE location_id = $1"],
  ["on_hand", "SELECT COALESCE(SUM(qty_on_hand), 0) AS on_hand FROM inventory_item WHERE location_id = $1"],
  ["equipment", "SELECT count(*)::int AS equipment FROM wms_equipment WHERE location_id = $1"],
  ["cycle_counts", "SELECT count(*)::int AS cycle_counts FROM cycle_count WHERE location_id = $1"],
];

async function stats(client, id) {
  const out = {};
  for (const [key, sql] of STATS) {
    try {
      const { rows } = await client.query(sql, [id]);
      out[key] = Number((rows[0] && rows[0][key]) || 0);
    } catch (err) {
      if (err && err.code === "42P01") { out[key] = 0; continue; }
      throw err;
    }
  }
  return out;
}

module.exports = { insert, findById, update, list, occupancy, stats };
