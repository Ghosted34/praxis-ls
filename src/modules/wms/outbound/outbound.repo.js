"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById } = require("../../../shared/db/query-helpers");

// outbound_order head + outbound_line children. All SQL lives here.
const base = makeRepo({
  table: "outbound_order",
  pk: "outbound_order_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "created_at DESC",
});

module.exports = {
  ...base,
  insertLine: (client, data) => insertOne(client, "outbound_line", data),
  getLine: (client, lineId) => getById(client, "outbound_line", "outbound_line_id", lineId),
  updateLine: (client, lineId, patch) => updateOne(client, "outbound_line", "outbound_line_id", lineId, patch),
  async listLines(client, orderId) {
    const { rows } = await client.query(
      "SELECT * FROM outbound_line WHERE outbound_order_id = $1 ORDER BY outbound_line_id",
      [orderId],
    );
    return rows;
  },
};
