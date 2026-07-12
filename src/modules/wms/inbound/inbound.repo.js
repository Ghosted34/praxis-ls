/**
 * Inbound/GRN repository (MOD-33). Factory base + a bespoke joined/filtered list
 * (putaway location slot + dossier, filter by qa_status/dossier).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "grn_inbound", pk: "grn_inbound_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.qa_status) { params.push(q.qa_status); wh.push("gi.qa_status = $" + params.length); }
    if (q.dossier_id) { params.push(q.dossier_id); wh.push("gi.dossier_id = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT gi.*, wl.zone, wl.aisle, wl.rack, wl.bin
         FROM grn_inbound gi
         LEFT JOIN warehouse_location wl ON wl.location_id = gi.putaway_location
         ${where}
        ORDER BY gi.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
