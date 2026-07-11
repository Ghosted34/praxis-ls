"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne } = require("../../../shared/db/query-helpers");

// inventory_item is the stock ledger head; stock_movement is its append-only
// movement journal. All SQL lives here (CONVENTIONS: repo is the only data layer).
const base = makeRepo({
  table: "inventory_item",
  pk: "inventory_item_id",
  activeColumn: null,
  searchColumn: "sku",
  orderBy: "created_at DESC",
});

module.exports = {
  ...base,
  insertMovement: (client, data) => insertOne(client, "stock_movement", data),
  async listMovements(client, inventoryItemId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await client.query(
      "SELECT * FROM stock_movement WHERE inventory_item_id = $1 ORDER BY moved_at DESC LIMIT $2 OFFSET $3",
      [inventoryItemId, limit, offset],
    );
    return rows;
  },
};
