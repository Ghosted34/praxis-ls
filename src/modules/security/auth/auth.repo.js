/**
 * Data access for login/session issuance. Not a makeRepo() CRUD resource —
 * auth has its own read/write shapes (credential lookup, session lifecycle).
 */
"use strict";

async function findByEmail(client, email) {
  const { rows } = await client.query(
    `SELECT user_id, email, full_name, password_hash, status, failed_logins,
            is_2fa_enabled
     FROM app_user
     WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

async function recordLoginSuccess(client, userId) {
  await client.query(
    `UPDATE app_user SET failed_logins = 0, last_login_at = now() WHERE user_id = $1`,
    [userId],
  );
}

async function recordLoginFailure(client, userId) {
  await client.query(
    `UPDATE app_user SET failed_logins = failed_logins + 1 WHERE user_id = $1`,
    [userId],
  );
}

async function createSession(client, { userId, deviceLabel, ip, userAgent, environment }) {
  const { rows } = await client.query(
    `INSERT INTO user_session (user_id, device_label, ip, user_agent, environment)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING session_id`,
    [userId, deviceLabel || null, ip || null, userAgent || null, environment || "live"],
  );
  return rows[0].session_id;
}

async function getActiveSession(client, sessionId) {
  const { rows } = await client.query(
    `SELECT session_id, user_id, killed_at FROM user_session WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function touchSession(client, sessionId) {
  await client.query(
    `UPDATE user_session SET last_seen_at = now() WHERE session_id = $1`,
    [sessionId],
  );
}

async function killSession(client, sessionId, killedBy) {
  await client.query(
    `UPDATE user_session SET killed_at = now(), killed_by = $2 WHERE session_id = $1 AND killed_at IS NULL`,
    [sessionId, killedBy || null],
  );
}

module.exports = {
  findByEmail,
  recordLoginSuccess,
  recordLoginFailure,
  createSession,
  getActiveSession,
  touchSession,
  killSession,
};
