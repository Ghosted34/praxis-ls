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

// ── Invitations / password recovery (0482) ──────────────────────────────────
// Only the SHA-256 hash of a token is ever stored, so a database read cannot be
// turned into a working link. Mirrors password_reset (0471) for staff.

async function createInvite(client, { portalUserId, tokenHash, purpose, expiresAt, ip }) {
  const { rows } = await client.query(
    `INSERT INTO portal_invite (portal_user_id, token_hash, purpose, expires_at, requested_ip)
     VALUES ($1,$2,$3,$4,$5) RETURNING invite_id`,
    [portalUserId, tokenHash, purpose, expiresAt, ip || null],
  );
  return rows[0];
}

/** One live link at a time — issuing a new token kills any outstanding ones. */
async function invalidateInvites(client, portalUserId) {
  await client.query(
    "UPDATE portal_invite SET used_at = now() WHERE portal_user_id = $1 AND used_at IS NULL",
    [portalUserId],
  );
}

async function findInviteByHash(client, tokenHash) {
  const { rows } = await client.query(
    "SELECT * FROM portal_invite WHERE token_hash = $1",
    [tokenHash],
  );
  return rows[0] || null;
}

async function markInviteUsed(client, inviteId) {
  await client.query("UPDATE portal_invite SET used_at = now() WHERE invite_id = $1", [inviteId]);
}

/**
 * Outstanding-invite state per user, for the staff screen.
 *
 * Lets the grant list say "invited, not yet accepted" instead of leaving staff to
 * guess whether the person ever got in — the whole reason this table exists.
 */
async function inviteStatus(client, portalUserId) {
  const { rows } = await client.query(
    `SELECT purpose, expires_at, used_at, created_at
       FROM portal_invite WHERE portal_user_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [portalUserId],
  );
  return rows[0] || null;
}

module.exports = {
  findByEmail, findById, insert, setPassword, setStatus, touchLogin, bumpFailed, list,
  createInvite, invalidateInvites, findInviteByHash, markInviteUsed, inviteStatus,
};
