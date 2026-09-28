"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");
const { AppError } = require("../../../utils/errors");

// inventory_item is the stock ledger head; stock_movement is its append-only
// movement journal. All SQL lives here (CONVENTIONS: repo is the only data layer).
const base = makeRepo({
  table: "inventory_item",
  pk: "inventory_item_id",
  activeColumn: null,
  searchColumn: "sku",
  orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "sku", "qty_on_hand"],
  // API F-28: makeRepo's list honours only limit/offset/q — any other key was
  // silently ignored, so an unsupported filter is refused rather than dropped.
  // `location_id` is the one this repo applies itself (`list` below).
  filterable: ["location_id"],
});

/** `?sort=` for the location branch, from the same allow-list as the base. */
function locationSort(sort) {
  const raw = sort === undefined || sort === "" ? "-created_at" : String(sort);
  const desc = raw.startsWith("-");
  const col = desc ? raw.slice(1) : raw;
  if (!base.cfg.sortable.includes(col)) {
    throw new AppError(
      "INVALID_SORT",
      `Cannot sort by "${col}". Sortable fields: ${base.cfg.sortable.join(", ")}.`,
      422,
      { sort: [`unsupported sort field "${col}"`] },
    );
  }
  // The id is the tie-break a stable page needs: two items with the same
  // quantity must not trade places between page 1 and page 2.
  return `${col} ${desc ? "DESC" : "ASC"}, inventory_item_id`;
}

module.exports = {
  ...base,

  /**
   * The shared list, plus `?location_id=` — one slot's stock.
   *
   * The location 360 used to read the tenant's first 50 stock lines and filter
   * them by slot in the browser, which under-counted every slot once the
   * warehouse passed 50 lines. It asks for its own slot here instead, a page at
   * a time with the true total, sortable by quantity for "On hand".
   */
  async list(client, q = {}, scopeIds = null) {
    if (!q.location_id) return base.list(client, q, scopeIds);
    const { limit, offset } = page(q);
    const order = locationSort(q.sort);
    const params = [limit, offset, q.location_id];
    const wh = ["location_id = $3"];
    if (q.q) {
      params.push(`%${q.q}%`);
      wh.push(`sku ILIKE $${params.length}`);
    }
    const { rows } = await client.query(
      `SELECT *, ${TOTAL_COL} FROM inventory_item WHERE ${wh.join(" AND ")}
        ORDER BY ${order} LIMIT $1 OFFSET $2`,
      params,
    );
    const split = splitTotal(rows);
    Object.defineProperty(split.rows, "_total", { value: split.total, enumerable: false });
    Object.defineProperty(split.rows, "_page", { value: { limit, offset }, enumerable: false });
    return split.rows;
  },

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
