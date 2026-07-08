/**
 * app_user is both the generic CRUD resource (list/get/create/update/
 * soft-delete on the app_user table, via the makeRepo/makeService/
 * makeController/makeRouter kit) and the home of auth's data access —
 * login/session lifecycle operate on this same table, so security/auth/
 * was folded in here rather than kept as a separate module directory.
 * See doc/WORK_DONE.md.
 */
"use strict";

const { makeRepo } = require("../../../shared/crud/resource");

const crud = makeRepo({
  table: "app_user",
  pk: "user_id",
  activeColumn: null,
  searchColumn: null,
  orderBy: "created_at DESC",
});

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

/** 2FA — findByEmail() intentionally omits totp_secret_enc (never needed
 *  until a 2FA-enabled user has already passed the password check). */
async function getTotpSecret(client, userId) {
  const { rows } = await client.query(
    `SELECT user_id, email, full_name, is_2fa_enabled, totp_secret_enc
     FROM app_user WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function setTotpSecret(client, userId, encSecret) {
  await client.query(`UPDATE app_user SET totp_secret_enc = $2 WHERE user_id = $1`, [
    userId,
    encSecret,
  ]);
}

/** Enabling clears nothing; disabling wipes the secret too (re-enrolling
 *  later generates a fresh one — never reactivate an old secret silently). */
async function setTotpEnabled(client, userId, enabled) {
  await client.query(
    `UPDATE app_user SET is_2fa_enabled = $2, totp_secret_enc = CASE WHEN $2 THEN totp_secret_enc ELSE NULL END
     WHERE user_id = $1`,
    [userId, enabled],
  );
}

module.exports = {
  ...crud,
  findByEmail,
  recordLoginSuccess,
  recordLoginFailure,
  createSession,
  getActiveSession,
  touchSession,
  killSession,
  getTotpSecret,
  setTotpSecret,
  setTotpEnabled,
};
