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
/** The logins behind a client team's grants. Emails are stored lowercased, so
 *  the comparison is on text rather than via a citext array parameter. */
async function usersByEmails(client, emails) {
  const { rows } = await client.query(
    `SELECT portal_user_id, email::text AS email, full_name, status, last_login_at
       FROM portal_user WHERE lower(email::text) = ANY($1::text[])`,
    [emails.map((e) => String(e).toLowerCase())],
  );
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

/** The newest invite/reset link for each of several logins, in one read. */
async function latestInvites(client, portalUserIds) {
  if (!portalUserIds.length) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT ON (portal_user_id) portal_user_id, purpose, expires_at, used_at, created_at
       FROM portal_invite WHERE portal_user_id = ANY($1::uuid[])
      ORDER BY portal_user_id, created_at DESC`,
    [portalUserIds],
  );
  return rows;
}

// ── Trusted-device sessions (14150) ─────────────────────────────────────────
// Only the SHA-256 of a refresh token is stored, same rule as the invite links
// above: a database read must not hand anyone a working session.

async function insertSession(client, { portalUserId, refreshHash, method, deviceLabel, userAgent, ip, expiresAt }) {
  const { rows } = await client.query(
    `INSERT INTO portal_session (portal_user_id, refresh_hash, method, device_label, user_agent, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING portal_session_id, portal_user_id, method, device_label, created_at, last_seen_at, expires_at`,
    [portalUserId, refreshHash, method, deviceLabel || null, userAgent || null, ip || null, expiresAt],
  );
  return rows[0];
}

/** The session a refresh token belongs to — as its CURRENT token or the one it
 *  rotated away from (the grace window). `matched` says which. */
async function findSessionByRefresh(client, refreshHash) {
  const { rows } = await client.query(
    `SELECT s.*, (s.refresh_hash = $1) AS is_current
       FROM portal_session s
      WHERE s.refresh_hash = $1 OR s.prev_refresh_hash = $1
      LIMIT 1`,
    [refreshHash],
  );
  return rows[0] || null;
}

/**
 * Rotate, but only if nobody else did first. The WHERE on the old hash is the
 * concurrency guard: two tabs presenting the same token race here, one wins,
 * and the loser gets zero rows back and is handled as the grace case.
 */
async function rotateSession(client, { sessionId, fromHash, toHash, expiresAt }) {
  const { rows } = await client.query(
    `UPDATE portal_session
        SET prev_refresh_hash = refresh_hash, refresh_hash = $3, rotated_at = now(),
            last_seen_at = now(), expires_at = $4
      WHERE portal_session_id = $1 AND refresh_hash = $2 AND revoked_at IS NULL
      RETURNING portal_session_id, portal_user_id, expires_at`,
    [sessionId, fromHash, toHash, expiresAt],
  );
  return rows[0] || null;
}

async function touchSession(client, sessionId) {
  await client.query("UPDATE portal_session SET last_seen_at = now() WHERE portal_session_id = $1", [sessionId]);
}

async function revokeSession(client, sessionId, portalUserId = null) {
  const { rows } = await client.query(
    `UPDATE portal_session SET revoked_at = now()
      WHERE portal_session_id = $1 AND revoked_at IS NULL
        AND ($2::uuid IS NULL OR portal_user_id = $2)
      RETURNING portal_session_id`,
    [sessionId, portalUserId],
  );
  return rows[0] || null;
}

async function revokeSessionByHash(client, refreshHash) {
  await client.query(
    "UPDATE portal_session SET revoked_at = now() WHERE refresh_hash = $1 AND revoked_at IS NULL",
    [refreshHash],
  );
}

/** Every live session of one person — a password reset or a disable ends them all. */
async function revokeAllSessions(client, portalUserId) {
  await client.query(
    "UPDATE portal_session SET revoked_at = now() WHERE portal_user_id = $1 AND revoked_at IS NULL",
    [portalUserId],
  );
}

async function sessionIsLive(client, sessionId) {
  const { rows } = await client.query(
    "SELECT 1 FROM portal_session WHERE portal_session_id = $1 AND revoked_at IS NULL AND expires_at > now()",
    [sessionId],
  );
  return rows.length > 0;
}

async function listSessions(client, portalUserId) {
  const { rows } = await client.query(
    `SELECT portal_session_id, method, device_label, created_at, last_seen_at, expires_at
       FROM portal_session
      WHERE portal_user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_seen_at DESC`,
    [portalUserId],
  );
  return rows;
}

// ── One-time sign-in codes (14150) ──────────────────────────────────────────

async function insertLoginCode(client, { portalUserId, codeHash, expiresAt, ip }) {
  const { rows } = await client.query(
    `INSERT INTO portal_login_code (portal_user_id, code_hash, expires_at, requested_ip)
     VALUES ($1,$2,$3,$4) RETURNING portal_login_code_id`,
    [portalUserId, codeHash, expiresAt, ip || null],
  );
  return rows[0];
}

/** One live code at a time — asking again retires the previous email's code. */
async function retireLoginCodes(client, portalUserId) {
  await client.query(
    "UPDATE portal_login_code SET used_at = now() WHERE portal_user_id = $1 AND used_at IS NULL",
    [portalUserId],
  );
}

async function latestLoginCode(client, portalUserId) {
  const { rows } = await client.query(
    `SELECT * FROM portal_login_code
      WHERE portal_user_id = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [portalUserId],
  );
  return rows[0] || null;
}

async function countRecentLoginCodes(client, portalUserId, minutes) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM portal_login_code
      WHERE portal_user_id = $1 AND created_at > now() - make_interval(mins => $2)`,
    [portalUserId, minutes],
  );
  return rows[0] ? rows[0].n : 0;
}

async function bumpLoginCodeAttempts(client, codeId) {
  const { rows } = await client.query(
    "UPDATE portal_login_code SET attempts = attempts + 1 WHERE portal_login_code_id = $1 RETURNING attempts",
    [codeId],
  );
  return rows[0] ? rows[0].attempts : 0;
}

async function useLoginCode(client, codeId) {
  const { rows } = await client.query(
    `UPDATE portal_login_code SET used_at = now()
      WHERE portal_login_code_id = $1 AND used_at IS NULL RETURNING portal_login_code_id`,
    [codeId],
  );
  return rows[0] || null;
}

// ── Portal passkeys (14150) ─────────────────────────────────────────────────

async function insertPasskey(client, { credentialId, portalUserId, publicKey, counter, transports, deviceType, backedUp, aaguid, label }) {
  const { rows } = await client.query(
    `INSERT INTO portal_passkey (credential_id, portal_user_id, public_key, counter, transports, device_type, backed_up, aaguid, label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING credential_id, portal_user_id, label, created_at, last_used_at`,
    [credentialId, portalUserId, publicKey, counter || 0, transports || null, deviceType || "singleDevice", !!backedUp, aaguid || null, label || null],
  );
  return rows[0];
}

/** What the account screen lists — never the public key. */
async function listPasskeys(client, portalUserId) {
  const { rows } = await client.query(
    `SELECT credential_id, label, device_type, backed_up, created_at, last_used_at
       FROM portal_passkey WHERE portal_user_id = $1 ORDER BY created_at DESC`,
    [portalUserId],
  );
  return rows;
}

async function passkeyIdsFor(client, portalUserId) {
  const { rows } = await client.query(
    "SELECT credential_id, transports FROM portal_passkey WHERE portal_user_id = $1",
    [portalUserId],
  );
  return rows;
}

async function getPasskey(client, credentialId) {
  const { rows } = await client.query("SELECT * FROM portal_passkey WHERE credential_id = $1", [credentialId]);
  return rows[0] || null;
}

async function updatePasskeyCounter(client, credentialId, counter) {
  await client.query(
    "UPDATE portal_passkey SET counter = $2, last_used_at = now() WHERE credential_id = $1",
    [credentialId, counter],
  );
}

async function deletePasskey(client, credentialId, portalUserId) {
  const { rows } = await client.query(
    "DELETE FROM portal_passkey WHERE credential_id = $1 AND portal_user_id = $2 RETURNING credential_id, label",
    [credentialId, portalUserId],
  );
  return rows[0] || null;
}

module.exports = {
  findByEmail, findById, insert, setPassword, setStatus, touchLogin, bumpFailed, list, usersByEmails,
  createInvite, invalidateInvites, findInviteByHash, markInviteUsed, inviteStatus, latestInvites,
  insertSession, findSessionByRefresh, rotateSession, touchSession, revokeSession,
  revokeSessionByHash, revokeAllSessions, sessionIsLive, listSessions,
  insertLoginCode, retireLoginCodes, latestLoginCode, countRecentLoginCodes,
  bumpLoginCodeAttempts, useLoginCode,
  insertPasskey, listPasskeys, passkeyIdsFor, getPasskey, updatePasskeyCounter, deletePasskey,
};
