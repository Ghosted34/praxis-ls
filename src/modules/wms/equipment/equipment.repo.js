/**
 * WMS-equipment repository (MOD-37). Factory base + a bespoke joined/filtered
 * list (location slot, filter by status/location).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "wms_equipment", pk: "wms_equipment_id", activeColumn: null, searchColumn: "label", orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.status) { params.push(q.status); wh.push("we.status = $" + params.length); }
    if (q.location_id) { params.push(q.location_id); wh.push("we.location_id = $" + params.length); }
    if (q.q) { params.push("%" + q.q + "%"); wh.push("we.label ILIKE $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT we.*, wl.zone, wl.aisle, wl.rack, wl.bin
         FROM wms_equipment we
         LEFT JOIN warehouse_location wl ON wl.location_id = we.location_id
         ${where}
        ORDER BY we.label
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
