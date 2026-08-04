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

  /**
   * Read the stock head FOR UPDATE — the row lock the balance path needs.
   *
   * DATA 5.1 (Critical). `move()` did read-modify-write on qty_on_hand with a
   * plain SELECT: two concurrent moves both read 10, one wrote 5, the other
   * wrote 7, and the answer was 7 instead of 2. Silent, and undetectable
   * afterwards because BOTH movement rows were written.
   *
   * FOR UPDATE serialises the readers of one item. It blocks only rows for that
   * item, so unrelated stock is unaffected.
   */
  async findByIdForUpdate(client, id) {
    const { rows } = await client.query(
      "SELECT * FROM inventory_item WHERE inventory_item_id = $1 FOR UPDATE",
      [id],
    );
    return rows[0] || null;
  },

  /**
   * Apply a SIGNED delta in SQL rather than writing an absolute value computed
   * in JavaScript.
   *
   * Even under FOR UPDATE this is the safer write: the new balance is derived
   * from the row the database holds, not from a number the application read
   * earlier. `WHERE qty_on_hand + $2 >= 0` is the second line of defence — if
   * the move would go negative the UPDATE matches zero rows and the caller
   * knows, without depending on a check that ran before the lock.
   */
  async applyDelta(client, id, delta, patch = {}) {
    const sets = ["qty_on_hand = qty_on_hand + $2", "updated_at = now()"];
    const params = [id, delta];
    if (patch.location_id) {
      params.push(patch.location_id);
      sets.push(`location_id = $${params.length}`);
    }
    const { rows } = await client.query(
      `UPDATE inventory_item SET ${sets.join(", ")}
        WHERE inventory_item_id = $1 AND qty_on_hand + $2 >= 0
        RETURNING *`,
      params,
    );
    return rows[0] || null;
  },

  insertMovement: (client, data) => insertOne(client, "stock_movement", data),
  async listMovements(client, inventoryItemId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await client.query(
      "SELECT * FROM stock_movement WHERE inventory_item_id = $1 ORDER BY moved_at DESC LIMIT $2 OFFSET $3",
      [inventoryItemId, limit, offset],
    );
    return rows;
  },
};
