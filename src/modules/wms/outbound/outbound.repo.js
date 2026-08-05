"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById, listComplete } = require("../../../shared/db/query-helpers");

// outbound_order head + outbound_line children. All SQL lives here.
const base = makeRepo({
  table: "outbound_order",
  pk: "outbound_order_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

module.exports = {
  ...base,
  insertLine: (client, data) => insertOne(client, "outbound_line", data),
  getLine: (client, lineId) => getById(client, "outbound_line", "outbound_line_id", lineId),
  updateLine: (client, lineId, patch) => updateOne(client, "outbound_line", "outbound_line_id", lineId, patch),
  async listLines(client, orderId) {
    const { rows } = await listComplete(client, "SELECT * FROM outbound_line WHERE outbound_order_id = $1 ORDER BY outbound_line_id", [orderId], { label: "Outbound lines", ceiling: 5000 });
    return rows;
  },
};
