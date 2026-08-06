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
async function recordPurge(c, { actorUserId, actorName, actorEmail, entityRef, payload, ip }) {
  // God-Mode purges are always sensitive (0510). Snapshot the actor's name
  // and email at write time so the Control Tower's self-scoped feed can
  // render them without a cross-schema join back to app_user. Existing
  // callers that don't pass actorName/actorEmail keep working — the columns
  // default NULL.
  await c.query(
    `INSERT INTO immutable_ledger (
       actor_user_id, actor_name_snapshot, actor_email_snapshot,
       action, module_key, entity_ref, before_json, ip, is_sensitive
     ) VALUES ($1,$2,$3,'godmode.purge','MOD-00B',$4,$5,$6, true)`,
    [actorUserId, actorName || null, actorEmail || null, entityRef, payload || null, ip || null],
  );
}
module.exports = { listSoftDeletes, getSoftDelete, pinHash, recordPurge };
