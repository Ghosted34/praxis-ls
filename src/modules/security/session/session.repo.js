"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const crud = makeRepo({
  table: "user_session",
  pk: "session_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "created_at DESC",
});

/** "Everyone... only their own sessions" (RBAC journey doc, Stop 1/22) —
 *  doesn't need a permission grant, just authentication. */
async function listForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT session_id, device_label, ip, user_agent, environment,
            created_at, last_seen_at, killed_at
     FROM user_session WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

async function kill(client, sessionId, killedBy) {
  const { rows } = await client.query(
    `UPDATE user_session SET killed_at = now(), killed_by = $2
     WHERE session_id = $1 AND killed_at IS NULL
     RETURNING session_id, user_id`,
    [sessionId, killedBy || null],
  );
  return rows[0] || null;
}


/** Kill all live sessions for a user (revoke-all). Returns the killed session ids. */
async function killAllForUser(client, userId, killedBy) {
  const { rows } = await client.query(
    "UPDATE session SET killed_at = now(), killed_by = $2 WHERE user_id = $1 AND killed_at IS NULL RETURNING session_id",
    [userId, killedBy || null],
  );
  return rows.map((r) => r.session_id);
}
module.exports = { ...crud, listForUser, kill, killAllForUser };
