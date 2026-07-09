"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const crud = makeRepo({
  table: "immutable_ledger",
  pk: "ledger_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "ledger_id DESC",
});

async function listSoftDeletes(client, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const { rows } = await client.query(
    `SELECT * FROM soft_delete WHERE restored_at IS NULL ORDER BY deleted_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function getSoftDelete(client, id) {
  const { rows } = await client.query(`SELECT * FROM soft_delete WHERE soft_delete_id = $1`, [id]);
  return rows[0] || null;
}

/** Step 1 of maker-checker: anyone with edit rights flags "please restore
 *  this" — doesn't touch the underlying record yet. */
async function requestRestore(client, id, requestedBy) {
  const { rows } = await client.query(
    `UPDATE soft_delete SET restore_requested_by = $2
     WHERE soft_delete_id = $1 AND restored_at IS NULL
     RETURNING *`,
    [id, requestedBy],
  );
  return rows[0] || null;
}

/** Step 2: a different admin actually confirms it (enforced by the
 *  service layer AND the DB's CHECK (restored_by <> deleted_by)). */
async function markRestored(client, id, restoredBy) {
  const { rows } = await client.query(
    `UPDATE soft_delete SET restored_by = $2, restored_at = now()
     WHERE soft_delete_id = $1 AND restored_at IS NULL
     RETURNING *`,
    [id, restoredBy],
  );
  return rows[0] || null;
}

/** table/pk/activeColumn always come from entity-registry.js (derived from
 *  our own module configs at boot, never from request input) — safe to
 *  interpolate directly, same trust boundary as query-helpers.js. */
async function rowExists(client, table, pk, id) {
  const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE ${pk} = $1`, [id]);
  return rows.length > 0;
}

async function reactivate(client, table, pk, activeColumn, id) {
  const { rowCount } = await client.query(`UPDATE ${table} SET ${activeColumn} = true WHERE ${pk} = $1`, [
    id,
  ]);
  return rowCount > 0;
}

/** Fallback for a record that's actually gone from its table (nothing in
 *  this codebase does a real DELETE today — archive() only ever flips
 *  activeColumn — but payload_json exists precisely so this stays
 *  recoverable if that ever changes). */
async function reinsertFromPayload(client, table, payload) {
  const keys = Object.keys(payload || {});
  if (keys.length === 0) return;
  const cols = keys.join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  await client.query(`INSERT INTO ${table} (${cols}) VALUES (${params}) ON CONFLICT DO NOTHING`, keys.map((k) => payload[k]));
}

module.exports = {
  ...crud,
  listSoftDeletes,
  getSoftDelete,
  requestRestore,
  markRestored,
  rowExists,
  reactivate,
  reinsertFromPayload,
};
