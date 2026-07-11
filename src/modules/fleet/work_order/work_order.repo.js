/**
 * Work-order repository (MOD-41). Factory base (findById/create/update for the
 * lifecycle service) + a bespoke filtered/joined list and a parts sub-resource.
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "work_order", pk: "work_order_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

module.exports = {
  ...base,
  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.vehicle_id) { params.push(q.vehicle_id); wh.push("wo.vehicle_id = $" + params.length); }
    if (q.status) { params.push(q.status); wh.push("wo.status = $" + params.length); }
    if (q.kind) { params.push(q.kind); wh.push("wo.kind = $" + params.length); }
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT wo.*, v.registration
         FROM work_order wo
         LEFT JOIN vehicle v ON v.vehicle_id = wo.vehicle_id
         ${where}
        ORDER BY wo.opened_on DESC, wo.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
  addPart: (client, part) => insertOne(client, "work_order_part", part),
  async listParts(client, workOrderId) {
    const { rows } = await client.query("SELECT * FROM work_order_part WHERE work_order_id = $1", [workOrderId]);
    return rows;
  },
};
