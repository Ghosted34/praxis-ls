"use strict";
async function listSoftDeletes(c) {
  const { rows } = await c.query("SELECT * FROM soft_delete WHERE restored_at IS NULL ORDER BY deleted_at DESC LIMIT 100");
  return rows;
}
async function getSoftDelete(c, id) {
  const { rows } = await c.query("SELECT * FROM soft_delete WHERE soft_delete_id=$1", [id]);
  return rows[0] || null;
}
async function pinHash(c, userId) {
  const { rows } = await c.query("SELECT godmode_pin_hash FROM app_user WHERE user_id=$1", [userId]);
  return rows[0] ? rows[0].godmode_pin_hash : null;
}
async function recordPurge(c, { actorUserId, entityRef, payload, ip }) {
  await c.query(
    "INSERT INTO immutable_ledger (actor_user_id, action, module_key, entity_ref, before_json, ip) VALUES ($1,'godmode.purge','MOD-00B',$2,$3,$4)",
    [actorUserId, entityRef, payload || null, ip || null],
  );
}
module.exports = { listSoftDeletes, getSoftDelete, pinHash, recordPurge };
