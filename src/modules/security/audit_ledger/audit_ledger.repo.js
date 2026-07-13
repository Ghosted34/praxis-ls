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

// ── Access reviews (4.1) ──
async function createReview(client, { name, createdBy }) {
  const { rows } = await client.query(
    "INSERT INTO access_review (name, created_by) VALUES ($1,$2) RETURNING *", [name, createdBy || null]);
  return rows[0];
}
/** Snapshot every ACTIVE user's roles into entries for a fresh review. */
async function snapshotEntries(client, reviewId) {
  await client.query(
    "INSERT INTO access_review_entry (review_id, user_id, roles_snapshot) " +
      "SELECT $1, u.user_id, " +
      "COALESCE(jsonb_agg(jsonb_build_object('role_id', r.role_id, 'code', r.code)) FILTER (WHERE r.role_id IS NOT NULL), '[]'::jsonb) " +
      "FROM app_user u " +
      "LEFT JOIN user_role ur ON ur.user_id = u.user_id " +
      "LEFT JOIN role r ON r.role_id = ur.role_id " +
      "WHERE u.status = 'ACTIVE' GROUP BY u.user_id",
    [reviewId]);
}
async function listReviews(client, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const { rows } = await client.query("SELECT * FROM access_review ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
  return rows;
}
async function getReview(client, id) {
  const { rows } = await client.query("SELECT * FROM access_review WHERE review_id = $1", [id]);
  return rows[0] || null;
}
async function listEntries(client, reviewId) {
  const { rows } = await client.query("SELECT * FROM access_review_entry WHERE review_id = $1 ORDER BY entry_id", [reviewId]);
  return rows;
}
async function decideEntry(client, { reviewId, entryId, decision, note, decidedBy }) {
  const { rows } = await client.query(
    "UPDATE access_review_entry SET decision = $3, note = $4, decided_by = $5, decided_at = now() " +
      "WHERE entry_id = $2 AND review_id = $1 RETURNING *",
    [reviewId, entryId, decision, note || null, decidedBy || null]);
  return rows[0] || null;
}
async function completeReview(client, { id, completedBy }) {
  const { rows } = await client.query(
    "UPDATE access_review SET completed_at = now(), completed_by = $2 WHERE review_id = $1 AND completed_at IS NULL RETURNING *",
    [id, completedBy || null]);
  return rows[0] || null;
}

// ── Security-events read (4.2) — security-critical rows out of event_log ──
async function listSecurityEvents(client, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const params = [limit, offset]; const wh = ["et.is_security_critical = true"];
  if (q.module) { params.push(q.module); wh.push("el.module_key = $" + params.length); }
  if (q.event_type) { params.push(q.event_type); wh.push("el.event_type_key = $" + params.length); }
  if (q.actor) { params.push(q.actor); wh.push("el.actor_user_id = $" + params.length); }
  if (q.from) { params.push(q.from); wh.push("el.created_at >= $" + params.length); }
  if (q.to) { params.push(q.to); wh.push("el.created_at <= $" + params.length); }
  const { rows } = await client.query(
    "SELECT el.event_id, el.event_type_key, el.module_key, el.entity_ref, el.actor_user_id, el.priority, el.payload, el.created_at " +
      "FROM event_log el JOIN event_type et ON et.key = el.event_type_key WHERE " + wh.join(" AND ") +
      " ORDER BY el.created_at DESC LIMIT $1 OFFSET $2",
    params);
  return rows;
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
  createReview, snapshotEntries, listReviews, getReview, listEntries, decideEntry, completeReview,
  listSecurityEvents,
};
