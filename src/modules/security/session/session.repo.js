"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const crud = makeRepo({
  // SEC H3. This is the table the audit's attack scenario names. PATCH
  // /sessions/:id reached updateOne against user_session with an unfiltered
  // body, so MOD-67 `edit` could clear killed_at — resurrecting an
  // administrator session security staff believed they had terminated — or
  // repoint user_id to hijack one.
  //
  // A session is CREATED by logging in and ENDED through the revoke endpoint.
  // Nothing about it is legitimately editable by a request body except the
  // label a user gives their device.
  writable: ["device_label"],
  table: "user_session",
  pk: "session_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
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
