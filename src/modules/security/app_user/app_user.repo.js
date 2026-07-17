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
    `SELECT session_id, user_id, killed_at, last_seen_at,
            EXTRACT(EPOCH FROM (now() - last_seen_at)) AS idle_seconds
       FROM user_session WHERE session_id = $1`,
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


// ── User administration (safe reads exclude secrets; role assignment) ──
const SAFE_COLS = "user_id, username, email, full_name, is_2fa_enabled, employee_id, status, failed_logins, last_login_at, created_at, updated_at";

async function insertUser(client, data) {
  const keys = Object.keys(data);
  const cols = keys.join(", ");
  const ph = keys.map((_, i) => "$" + (i + 1)).join(", ");
  const { rows } = await client.query(
    "INSERT INTO app_user (" + cols + ") VALUES (" + ph + ") RETURNING " + SAFE_COLS,
    keys.map((k) => data[k]),
  );
  return rows[0];
}
async function getUserSafe(client, id) {
  const { rows } = await client.query("SELECT " + SAFE_COLS + " FROM app_user WHERE user_id = $1", [id]);
  return rows[0] || null;
}
async function listUsersSafe(client, { limit = 50, offset = 0, status = null, q = null }) {
  const params = [limit, offset]; const wh = [];
  if (status) { params.push(status); wh.push("status = $" + params.length); }
  if (q) { params.push("%" + q + "%"); wh.push("(full_name ILIKE $" + params.length + " OR email ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT " + SAFE_COLS + " FROM app_user " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
async function updateUserFields(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getUserSafe(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE app_user SET " + set + ", updated_at = now() WHERE user_id = $1 RETURNING " + SAFE_COLS, [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function setPasswordHash(client, id, hash) {
  const { rows } = await client.query("UPDATE app_user SET password_hash = $2, updated_at = now() WHERE user_id = $1 RETURNING " + SAFE_COLS, [id, hash]);
  return rows[0] || null;
}
async function setStatus(client, id, status) {
  const { rows } = await client.query("UPDATE app_user SET status = $2, updated_at = now() WHERE user_id = $1 RETURNING " + SAFE_COLS, [id, status]);
  return rows[0] || null;
}
async function setRoles(client, id, roleIds) {
  await client.query("DELETE FROM user_role WHERE user_id = $1", [id]);
  for (const rid of roleIds || []) {
    /// eslint-disable-next-line no-await-in-loop
    await client.query("INSERT INTO user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, rid]);
  }
}
async function roleCodes(client, id) {
  const { rows } = await client.query("SELECT r.code FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = $1", [id]);
  return rows.map((r) => r.code);
}
async function roleIds(client, id) {
  const { rows } = await client.query("SELECT role_id FROM user_role WHERE user_id = $1", [id]);
  return rows.map((r) => r.role_id);
}
/** Count ACTIVE users holding the CEO role (for the last-CEO guard). */
async function countActiveCeos(client) {
  const { rows } = await client.query(
    "SELECT COUNT(DISTINCT u.user_id)::int AS n FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id JOIN role r ON r.role_id = ur.role_id WHERE r.code = 'CEO' AND u.status = 'ACTIVE'",
  );
  return rows[0].n;
}

// ── Device-bound quick PIN login (user_device) ──
async function insertDevice(client, { userId, label, pinHash }) {
  const { rows } = await client.query(
    "INSERT INTO user_device (user_id, label, pin_hash) VALUES ($1,$2,$3) RETURNING device_id, label, status, created_at",
    [userId, label || null, pinHash]);
  return rows[0];
}
async function getActiveDeviceForUser(client, deviceId, userId) {
  const { rows } = await client.query(
    "SELECT * FROM user_device WHERE device_id = $1 AND user_id = $2 AND status = 'ACTIVE'", [deviceId, userId]);
  return rows[0] || null;
}
async function listDevices(client, userId) {
  const { rows } = await client.query(
    "SELECT device_id, label, status, failed_pin, last_used_at, created_at FROM user_device WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return rows;
}
async function recordDevicePinFailure(client, deviceId) {
  const { rows } = await client.query(
    "UPDATE user_device SET failed_pin = failed_pin + 1 WHERE device_id = $1 RETURNING failed_pin", [deviceId]);
  return rows[0] || { failed_pin: 0 };
}
async function resetDevicePin(client, deviceId) {
  await client.query("UPDATE user_device SET failed_pin = 0, last_used_at = now() WHERE device_id = $1", [deviceId]);
}
async function revokeDevice(client, deviceId, userId) {
  const { rows } = await client.query(
    "UPDATE user_device SET status = 'REVOKED' WHERE device_id = $1 AND user_id = $2 RETURNING device_id", [deviceId, userId]);
  return rows[0] || null;
}

// ── Per-user email signature (2.1) ──
async function getSignature(client, userId) {
  const { rows } = await client.query("SELECT user_id, html, updated_at FROM email_signature WHERE user_id = $1", [userId]);
  return rows[0] || { user_id: userId, html: "", updated_at: null };
}
async function upsertSignature(client, userId, html) {
  const { rows } = await client.query(
    "INSERT INTO email_signature (user_id, html) VALUES ($1,$2) " +
      "ON CONFLICT (user_id) DO UPDATE SET html = EXCLUDED.html, updated_at = now() RETURNING user_id, html, updated_at",
    [userId, html || ""]);
  return rows[0];
}
/** CEO role_id, for the last-owner guard on role changes (4.3). */
async function ceoRoleId(client) {
  const { rows } = await client.query("SELECT role_id FROM role WHERE code = 'CEO' LIMIT 1");
  return rows[0] ? rows[0].role_id : null;
}

module.exports = {
  ...crud,
  insertUser, getUserSafe, listUsersSafe, updateUserFields, setPasswordHash, setStatus, setRoles, roleCodes, roleIds, countActiveCeos,
  getSignature, upsertSignature, ceoRoleId,
  insertDevice, getActiveDeviceForUser, listDevices, recordDevicePinFailure, resetDevicePin, revokeDevice,
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
