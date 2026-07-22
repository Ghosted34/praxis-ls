/** portal_user data access (0460). Credentials store for external portal users. */
"use strict";

const SAFE = "portal_user_id, email, full_name, status, last_login_at, created_at";

async function findByEmail(client, email) {
  const { rows } = await client.query("SELECT * FROM portal_user WHERE email=$1", [String(email || "").toLowerCase()]);
  return rows[0] || null;
}
async function findById(client, id) {
  const { rows } = await client.query(`SELECT ${SAFE} FROM portal_user WHERE portal_user_id=$1`, [id]);
  return rows[0] || null;
}
async function insert(client, { email, passwordHash, fullName }) {
  const { rows } = await client.query(
    `INSERT INTO portal_user (email, password_hash, full_name) VALUES ($1,$2,$3) RETURNING ${SAFE}`,
    [String(email).toLowerCase(), passwordHash, fullName || null],
  );
  return rows[0];
}
async function setPassword(client, id, passwordHash) {
  const { rows } = await client.query(
    `UPDATE portal_user SET password_hash=$2, failed_logins=0 WHERE portal_user_id=$1 RETURNING ${SAFE}`,
    [id, passwordHash],
  );
  return rows[0] || null;
}
async function setStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE portal_user SET status=$2 WHERE portal_user_id=$1 RETURNING ${SAFE}`,
    [id, status],
  );
  return rows[0] || null;
}
async function touchLogin(client, id) {
  await client.query("UPDATE portal_user SET last_login_at=now(), failed_logins=0 WHERE portal_user_id=$1", [id]);
}
async function bumpFailed(client, id) {
  await client.query("UPDATE portal_user SET failed_logins=failed_logins+1 WHERE portal_user_id=$1", [id]);
}
async function list(client) {
  const { rows } = await client.query(`SELECT ${SAFE} FROM portal_user ORDER BY created_at DESC`);
  return rows;
}

module.exports = { findByEmail, findById, insert, setPassword, setStatus, touchLogin, bumpFailed, list };
