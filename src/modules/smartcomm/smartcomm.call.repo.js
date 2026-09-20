/**
 * Smart Comms Calls (PR-1) — repository. All SQL for call state and
 * per-user last-seen presence lives here, per the module convention.
 *
 * The state machine is owned by smartcomm.call.service.js; this file only
 * reads and writes rows. Transitions are single UPDATEs guarded by the
 * row's CURRENT status, so two racing transitions (a hangup arriving the
 * same instant as the 30-minute cap) cannot both win: the second matches
 * zero rows and the service treats that as "already moved on".
 */
"use strict";

const ACTIVE_STATUSES = ["RINGING", "IN_CALL"];

/** The user's active call (either role), or null. For NAMING the busy error;
 *  the partial unique indexes — not this SELECT — are the actual guard,
 *  because a pre-check can race itself between the SELECT and the INSERT. */
async function findActiveCall(client, userId) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call
     WHERE (caller_id = $1 OR callee_id = $1) AND status IN ('RINGING','IN_CALL')
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

/** Insert a RINGING call. Returns `{ call }` on success or
 *  `{ call: null, busyWith }` when a partial unique index rejected the insert
 *  because one of the two users is already on a call (guide D8). The service
 *  decides which of the two users it was and says so in the error. */
async function insertCall(client, { groupId, callerId, calleeId }) {
  try {
    const { rows } = await client.query(
      `INSERT INTO comms_call (group_id, caller_id, callee_id, status)
       VALUES ($1, $2, $3, 'RINGING')
       RETURNING *`,
      [groupId, callerId, calleeId],
    );
    return { call: rows[0], busyWith: null };
  } catch (err) {
    if (err && err.code === "23505") {
      const busyWith =
        (await findActiveCall(client, callerId)) || (await findActiveCall(client, calleeId));
      return { call: null, busyWith };
    }
    throw err;
  }
}

async function findCall(client, callId) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call WHERE call_id = $1`,
    [callId],
  );
  return rows[0] || null;
}

/** Guarded transition: only moves the row if it is still `fromStatus`.
 *  Returns the updated row, or null when someone got there first. */
async function transition(client, { callId, fromStatus, status, fields = {} }) {
  const setCols = ["status = $" + 3];
  const params = [callId, fromStatus, status];
  for (const [col, value] of Object.entries(fields)) {
    params.push(value);
    setCols.push(`${col} = $${params.length}`);
  }
  const { rows } = await client.query(
    `UPDATE comms_call SET ${setCols.join(", ")}
     WHERE call_id = $1 AND status = $2
     RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Who is the other participant of this call, relative to `userId`. */
async function otherParticipant(client, { callId, userId }) {
  const { rows } = await client.query(
    `SELECT CASE WHEN caller_id = $2 THEN callee_id ELSE caller_id END AS user_id
     FROM comms_call WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)`,
    [callId, userId],
  );
  return rows[0] || null;
}

/** Does `userId` participate in this call at all (any status)? */
async function isParticipant(client, { callId, userId }) {
  const { rows } = await client.query(
    `SELECT 1 AS ok FROM comms_call
     WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)`,
    [callId, userId],
  );
  return rows.length > 0;
}

/** The other member of a DIRECT channel (the dial target when the icon is
 *  on the channel header). Null for non-DIRECT channels or channels with
 *  more than one other member — the header icon only renders on DIRECT. */
async function directPartner(client, { groupId, userId }) {
  const { rows } = await client.query(
    `SELECT m.user_id
     FROM comms_group g
     JOIN comms_member m ON m.group_id = g.group_id
     WHERE g.group_id = $1 AND g.kind = 'DIRECT' AND m.user_id <> $2
     LIMIT 1`,
    [groupId, userId],
  );
  return rows[0] || null;
}

async function listCallsForUser(client, userId, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT c.*, g.name AS channel_name,
            cu.full_name AS caller_name,
            bu.full_name AS callee_name
     FROM comms_call c
     JOIN comms_group g ON g.group_id = c.group_id
     JOIN app_user cu ON cu.user_id = c.caller_id
     JOIN app_user bu ON bu.user_id = c.callee_id
     WHERE c.caller_id = $1 OR c.callee_id = $1
     ORDER BY c.started_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(200, limit))],
  );
  return rows;
}

/** Last-seen upsert — the presence beat (§4.11). A single row per user; the
 *  live "online now" half is the socket itself, not this table. */
async function touchPresence(client, userId) {
  const { rows } = await client.query(
    `INSERT INTO comms_user_presence (user_id, last_seen_at)
     VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()
     RETURNING *`,
    [userId],
  );
  return rows[0];
}

async function lastSeen(client, userIds) {
  if (!userIds.length) return [];
  const { rows } = await client.query(
    `SELECT user_id, last_seen_at FROM comms_user_presence
     WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows;
}

module.exports = {
  ACTIVE_STATUSES,
  findActiveCall,
  insertCall,
  findCall,
  transition,
  otherParticipant,
  isParticipant,
  directPartner,
  listCallsForUser,
  touchPresence,
  lastSeen,
};
