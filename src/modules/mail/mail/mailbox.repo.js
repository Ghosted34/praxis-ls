/**
 * SQL for the mailbox foundation: the shared-mailbox catalogue, connection
 * lifecycle, access grants and the send-rate counters.
 *
 * Split out of mail.repo.js rather than added to it. mail.repo.js is the engine's
 * data access — connections as transport, messages, attachments. This is the
 * administration of mailboxes as ORGANISATIONAL objects: who owns one, who may
 * work it, which team address it is. Two different questions, two different
 * files, and the engine keeps not needing to know about members.
 */
"use strict";

const { insertOne, updateOne, getById } = require("../../../shared/db/query-helpers");

/* ── Shared-mailbox catalogue ────────────────────────────────────────────── */

async function listCatalogue(client, { includeDisabled = false } = {}) {
  const { rows } = await client.query(
    `SELECT c.*,
            k.email_connection_id, k.email_address, k.status AS connection_status
       FROM mail_shared_catalogue c
       LEFT JOIN email_connection k
              ON k.catalogue_key = c.catalogue_key AND k.status <> 'ARCHIVED'
      WHERE ($1::boolean IS TRUE OR c.is_enabled)
      ORDER BY c.sort_order, c.catalogue_key`,
    [includeDisabled],
  );
  return rows;
}

const getCatalogueEntry = (client, key) =>
  client.query("SELECT * FROM mail_shared_catalogue WHERE catalogue_key = $1", [key]).then((r) => r.rows[0] || null);

const upsertCatalogueEntry = (client, data) => insertOne(client, "mail_shared_catalogue", data);
const updateCatalogueEntry = (client, key, patch) =>
  updateOne(client, "mail_shared_catalogue", "catalogue_key", key, patch);

/* ── Connections as organisational objects ───────────────────────────────── */

/**
 * Every mailbox an administrator can see, with its health inputs and how many
 * people hold a live grant on it. Deliberately NOT filtered by membership — this
 * is the administration inventory; the workspace list is `listForUser`.
 */
async function listAll(client, { kind = null, includeArchived = false } = {}) {
  const { rows } = await client.query(
    `SELECT c.email_connection_id, c.email_address, c.display_name, c.provider, c.kind,
            c.visibility, c.status, c.catalogue_key, c.department, c.entity_id,
            c.owner_user_id, c.is_default, c.last_sync_at, c.last_success_at,
            c.last_error, c.consecutive_failures, c.archived_at,
            c.send_limit_hourly, c.send_limit_daily, c.sync_depth_days, c.history_imported_at,
            c.created_at,
            u.full_name AS owner_name,
            cat.label_en AS catalogue_label,
            (SELECT count(*) FROM email_connection_member m
              WHERE m.email_connection_id = c.email_connection_id AND m.revoked_at IS NULL) AS member_count
       FROM email_connection c
       LEFT JOIN app_user u ON u.user_id = c.owner_user_id
       LEFT JOIN mail_shared_catalogue cat ON cat.catalogue_key = c.catalogue_key
      WHERE ($1::text IS NULL OR c.kind = $1)
        AND ($2::boolean IS TRUE OR c.status <> 'ARCHIVED')
      ORDER BY c.kind, cat.sort_order NULLS LAST, c.email_address`,
    [kind, includeArchived],
  );
  return rows;
}

/**
 * The mailboxes one person may actually work: their own personal one, plus every
 * shared or delegated mailbox they hold a live grant on. This is the query the
 * workspace uses, and it is the only place the two access rules live.
 */
async function listForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT c.email_connection_id, c.email_address, c.display_name, c.provider, c.kind,
            c.status, c.catalogue_key, c.is_default, c.last_sync_at, c.last_success_at,
            c.last_error, c.consecutive_failures,
            cat.label_en AS catalogue_label,
            CASE WHEN c.kind = 'PERSONAL' THEN 'OWNER' ELSE m.member_role END AS access_role
       FROM email_connection c
       LEFT JOIN mail_shared_catalogue cat ON cat.catalogue_key = c.catalogue_key
       LEFT JOIN email_connection_member m
              ON m.email_connection_id = c.email_connection_id
             AND m.user_id = $1 AND m.revoked_at IS NULL
      WHERE c.status <> 'ARCHIVED'
        AND ((c.kind = 'PERSONAL' AND c.owner_user_id = $1) OR m.user_id IS NOT NULL)
      ORDER BY (c.kind = 'PERSONAL') DESC, cat.sort_order NULLS LAST, c.email_address`,
    [userId],
  );
  return rows;
}

const getConnection = (client, id) => getById(client, "email_connection", "email_connection_id", id);
const updateConnection = (client, id, patch) =>
  updateOne(client, "email_connection", "email_connection_id", id, patch);

const personalFor = (client, userId) =>
  client.query(
    `SELECT * FROM email_connection
      WHERE owner_user_id = $1 AND kind = 'PERSONAL' AND status <> 'ARCHIVED'`,
    [userId],
  ).then((r) => r.rows[0] || null);

const connectionForCatalogue = (client, key) =>
  client.query(
    "SELECT * FROM email_connection WHERE catalogue_key = $1 AND status <> 'ARCHIVED'",
    [key],
  ).then((r) => r.rows[0] || null);

/* ── Access grants ───────────────────────────────────────────────────────── */

async function listMembers(client, connectionId, { includeRevoked = false } = {}) {
  const { rows } = await client.query(
    `SELECT m.email_connection_member_id, m.user_id, m.member_role, m.granted_at, m.revoked_at,
            u.full_name, u.email,
            e.job_title, e.department
       FROM email_connection_member m
       JOIN app_user u ON u.user_id = m.user_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE m.email_connection_id = $1
        AND ($2::boolean IS TRUE OR m.revoked_at IS NULL)
      ORDER BY (m.revoked_at IS NOT NULL), u.full_name`,
    [connectionId, includeRevoked],
  );
  return rows;
}

const liveMember = (client, connectionId, userId) =>
  client.query(
    `SELECT * FROM email_connection_member
      WHERE email_connection_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [connectionId, userId],
  ).then((r) => r.rows[0] || null);

const insertMember = (client, data) => insertOne(client, "email_connection_member", data);

const setMemberRole = (client, connectionId, userId, role) =>
  client.query(
    `UPDATE email_connection_member SET member_role = $3
      WHERE email_connection_id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING *`,
    [connectionId, userId, role],
  ).then((r) => r.rows[0] || null);

const revokeMember = (client, connectionId, userId, revokedBy) =>
  client.query(
    `UPDATE email_connection_member SET revoked_at = now(), revoked_by = $3
      WHERE email_connection_id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING *`,
    [connectionId, userId, revokedBy],
  ).then((r) => r.rows[0] || null);

/** Withdraw every grant a person holds — the offboarding sweep. */
const revokeAllForUser = (client, userId, revokedBy) =>
  client.query(
    `UPDATE email_connection_member SET revoked_at = now(), revoked_by = $2
      WHERE user_id = $1 AND revoked_at IS NULL
      RETURNING email_connection_id`,
    [userId, revokedBy],
  ).then((r) => r.rows);

const recordAccessAudit = (client, data) => insertOne(client, "email_access_audit", data);

async function listAccessAudit(client, { connectionId = null, limit = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT a.*, u.full_name AS actor_name, s.full_name AS subject_name
       FROM email_access_audit a
       LEFT JOIN app_user u ON u.user_id = a.actor_user_id
       LEFT JOIN app_user s ON s.user_id = a.subject_user_id
      WHERE ($1::uuid IS NULL OR a.email_connection_id = $1)
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [connectionId, Math.min(Number(limit) || 100, 500)],
  );
  return rows;
}

/* ── Send-rate counters ──────────────────────────────────────────────────── */

/**
 * How many messages this mailbox has sent in the current hour and the last 24.
 * One query, because two round trips could straddle an hour boundary and
 * disagree.
 */
async function sendCounts(client, connectionId, windowStart) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(sent_count) FILTER (WHERE window_start = $2), 0)::int AS hourly,
            COALESCE(SUM(sent_count) FILTER (WHERE window_start > $2 - interval '24 hours'), 0)::int AS daily
       FROM email_send_window
      WHERE email_connection_id = $1`,
    [connectionId, windowStart],
  );
  return rows[0] || { hourly: 0, daily: 0 };
}

const bumpSendWindow = (client, connectionId, windowStart, by = 1) =>
  client.query(
    `INSERT INTO email_send_window (email_connection_id, window_start, sent_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (email_connection_id, window_start)
     DO UPDATE SET sent_count = email_send_window.sent_count + EXCLUDED.sent_count,
                   updated_at = now()
     RETURNING sent_count`,
    [connectionId, windowStart, by],
  ).then((r) => r.rows[0]);

/* ── Health book-keeping ─────────────────────────────────────────────────── */

const clearFailures = (client, id) =>
  updateOne(client, "email_connection", "email_connection_id", id, {
    consecutive_failures: 0, last_success_at: new Date(), last_error: null,
  });

/**
 * Count a failed sync and, at the third in a row, flip a CONNECTED mailbox to
 * ERROR. Three rather than one because a single missed poll is a wobble, and an
 * indicator that cries at every wobble is one people learn to ignore.
 */
const bumpFailure = (client, id, message) =>
  client.query(
    `UPDATE email_connection
        SET consecutive_failures = consecutive_failures + 1,
            last_error = $2,
            status = CASE WHEN consecutive_failures + 1 >= 3 AND status = 'CONNECTED'
                          THEN 'ERROR' ELSE status END
      WHERE email_connection_id = $1
      RETURNING consecutive_failures, status`,
    [id, String(message || "").slice(0, 500)],
  ).then((r) => r.rows[0] || null);

/** Counters are not a log; email_send_log is. Anything past 48h is noise. */
const sweepSendWindows = (client) =>
  client.query("DELETE FROM email_send_window WHERE window_start < now() - interval '48 hours'");

module.exports = {
  listCatalogue, getCatalogueEntry, upsertCatalogueEntry, updateCatalogueEntry,
  listAll, listForUser, getConnection, updateConnection, personalFor, connectionForCatalogue,
  listMembers, liveMember, insertMember, setMemberRole, revokeMember, revokeAllForUser,
  recordAccessAudit, listAccessAudit,
  sendCounts, bumpSendWindow, sweepSendWindows,
  clearFailures, bumpFailure,
};
