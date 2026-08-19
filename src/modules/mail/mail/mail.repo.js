/** Mail repository — per-purpose sender identities + the outbound send log
 *  (read-only view), PLUS the provider-agnostic engine's connections and the
 *  enriched inbound/thread store (0480/0481). All SQL lives here. */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");

async function listIdentities(client) {
  const { rows } = await client.query(
    "SELECT i.email_identity_id, i.purpose, i.from_address, i.from_name, i.reply_to, i.smtp_host, i.smtp_port, i.is_active, " +
      "COALESCE(array_agg(b.section_key) FILTER (WHERE b.section_key IS NOT NULL), '{}') AS sections " +
      "FROM email_identity i LEFT JOIN email_section_binding b ON b.email_identity_id = i.email_identity_id " +
      "WHERE i.archived_at IS NULL GROUP BY i.email_identity_id ORDER BY i.purpose",
  );
  return rows;
}

/** Replace the ERP sections a sender is bound to (WS-E3). A section maps to ONE
 *  sender, so claiming a section re-points it away from whatever sender had it. */
async function setBindingsForIdentity(client, identityId, sectionKeys) {
  await client.query("DELETE FROM email_section_binding WHERE email_identity_id = $1", [identityId]);
  const keys = [...new Set((sectionKeys || []).map((s) => String(s).trim()).filter(Boolean))];
  for (const key of keys) {
    await client.query(
      "INSERT INTO email_section_binding (email_identity_id, section_key) VALUES ($1, $2) " +
        "ON CONFLICT (section_key) DO UPDATE SET email_identity_id = EXCLUDED.email_identity_id",
      [identityId, key],
    );
  }
}

async function listSentLog(client, { limit = 100, offset = 0, identityId = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 100, 1), 500), Number(offset) || 0];
  let where = "";
  if (identityId) { params.push(identityId); where = "WHERE l.email_identity_id = $3"; }
  const { rows } = await client.query(
    "SELECT l.email_send_id, l.email_identity_id, l.to_address, l.subject, l.entity_ref, l.status, " +
      "l.provider_message_id, l.error, l.queued_at, l.sent_at, " +
      "i.purpose, i.from_address, i.from_name " +
      "FROM email_send_log l LEFT JOIN email_identity i ON i.email_identity_id = l.email_identity_id " +
      where + " ORDER BY l.queued_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/**
 * The legacy flat inbox view (GET /mail/inbox), kept working over the new store.
 *
 * It predates threads and returns messages, not conversations, so it reads
 * email_message directly. `is_read` here is "read by ANYONE", which is the old
 * semantics — honest for a legacy endpoint, and the reason the thread list does
 * not use this query. New surfaces use thread.repo.
 */
async function listInbox(client, { limit = 100, offset = 0, identityId = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 100, 1), 500), Number(offset) || 0];
  let where = "WHERE m.direction = 'IN'";
  if (identityId) { params.push(identityId); where += ` AND m.email_identity_id = $${params.length}`; }
  const { rows } = await client.query(
    "SELECT m.email_message_id AS email_inbound_id, m.email_identity_id, m.from_address, " +
      "array_to_string(m.to_address::text[], ', ') AS to_address, m.subject, m.body_preview, " +
      "t.entity_ref, EXISTS (SELECT 1 FROM email_message_state s " +
      "  WHERE s.email_message_id = m.email_message_id AND s.is_read) AS is_read, " +
      "m.received_at, i.purpose " +
      "FROM email_message m " +
      "JOIN email_thread t ON t.email_thread_id = m.email_thread_id " +
      "LEFT JOIN email_identity i ON i.email_identity_id = m.email_identity_id " +
      where + " ORDER BY m.received_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

const IDENTITY_WRITABLE = ["from_name", "reply_to", "smtp_host", "smtp_port", "is_active"];
const IDENTITY_COLS = "email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active";

async function updateIdentity(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder. This one already had the right
  // instinct — an explicit column allow-list — but applied it by FILTERING,
  // which silently drops an unwritable field and reports success. Passed to
  // updateOne it becomes a 422 naming the field, which is the same list doing
  // the same job honestly.
  const keys = Object.keys(fields).filter((k) => IDENTITY_WRITABLE.includes(k));
  if (!keys.length) return null;
  const patch = Object.fromEntries(keys.map((k) => [k, fields[k]]));
  return updateOne(client, "email_identity", "email_identity_id", id, patch, IDENTITY_COLS, IDENTITY_WRITABLE);
}

async function upsertIdentity(client, d) {
  const ex = (await client.query("SELECT email_identity_id FROM email_identity WHERE purpose = $1 ORDER BY created_at LIMIT 1", [d.purpose])).rows[0];
  if (ex) {
    const { rows } = await client.query(
      "UPDATE email_identity SET from_address = COALESCE($2, from_address), from_name = COALESCE($3, from_name), " +
        "reply_to = $4, smtp_host = $5, smtp_port = $6, is_active = COALESCE($7, is_active) " +
        "WHERE email_identity_id = $1 RETURNING email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active",
      [ex.email_identity_id, d.from_address || null, d.from_name || null, d.reply_to || null, d.smtp_host || null, d.smtp_port || null, d.is_active],
    );
    return rows[0];
  }
  const { rows } = await client.query(
    "INSERT INTO email_identity (purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active) " +
      "VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true)) " +
      "RETURNING email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active",
    [d.purpose, d.from_address, d.from_name, d.reply_to || null, d.smtp_host || null, d.smtp_port || null, d.is_active],
  );
  return rows[0];
}

/** Soft-archive a sender identity — hidden from listIdentities, never deleted. */
async function archiveIdentity(client, id) {
  const { rows } = await client.query(
    "UPDATE email_identity SET archived_at = now() WHERE email_identity_id = $1 AND archived_at IS NULL RETURNING email_identity_id",
    [id],
  );
  return rows[0] || null;
}

// ── Engine: connections (email_connection, 0480) ──
const insertConnection = (client, data) => insertOne(client, "email_connection", data);
const getConnection = (client, id) => getById(client, "email_connection", "email_connection_id", id);
const updateConnection = (client, id, patch) => updateOne(client, "email_connection", "email_connection_id", id, patch);

async function listConnections(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  let where = "";
  // Per-user isolation (WS-E8): callers pass ownerUserId so a user sees only
  // their own connected mailboxes. Absent = unscoped (internal callers only).
  if (q.ownerUserId) { params.push(q.ownerUserId); where = "WHERE owner_user_id = $3 "; }
  const { rows } = await client.query(
    "SELECT email_connection_id, email_address, provider, display_name, status, last_sync_at, last_error, " +
      "imap_host, imap_port, smtp_host, smtp_port, auth_user, owner_user_id, is_default, created_at " +
      "FROM email_connection " + where + "ORDER BY is_default DESC, created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/** Connections the sync worker should poll: any CONNECTED mailbox (IMAP polls,
 *  Graph/Gmail delta-poll — all provider-agnostic through the engine). */
async function listSyncable(client) {
  return (await client.query(
    "SELECT * FROM email_connection WHERE status = 'CONNECTED'",
  )).rows;
}

/** Find a connection by mailbox address + provider (OAuth reconnect / upsert). */
async function findByAddress(client, emailAddress, provider) {
  return (await client.query(
    "SELECT * FROM email_connection WHERE email_address = $1 AND provider = $2",
    [emailAddress, provider],
  )).rows[0] || null;
}

/** Push subscriptions due for renewal (within `hours` of expiry). */
async function listRenewable(client, hours = 24) {
  return (await client.query(
    "SELECT * FROM email_connection WHERE status = 'CONNECTED' AND push_subscription_id IS NOT NULL " +
      "AND (push_expires_at IS NULL OR push_expires_at < now() + ($1 || ' hours')::interval)",
    [String(hours)],
  )).rows;
}

async function setCursor(client, id, cursor) {
  await client.query(
    "UPDATE email_connection SET sync_cursor = $2, last_sync_at = now(), last_error = NULL, status = 'CONNECTED' WHERE email_connection_id = $1",
    [id, cursor],
  );
}
async function setError(client, id, message) {
  await client.query(
    "UPDATE email_connection SET status = 'ERROR', last_error = $2 WHERE email_connection_id = $1",
    [id, String(message || "").slice(0, 2000)],
  );
}

/** Set one connection as the owner's default send-from box (clears the rest).
 *  Owner-scoped: a foreign id is a no-op — it never clears the caller's default.
 *  Clears the OLD default BEFORE setting the new one: a single
 *  `is_default = (id = $1)` UPDATE can momentarily leave two rows true and trip
 *  the partial unique index (ux_email_connection_owner_default) mid-statement. */
async function setDefaultConnection(client, id, ownerUserId) {
  const owns = (await client.query(
    "SELECT 1 FROM email_connection WHERE email_connection_id = $1 AND owner_user_id = $2",
    [id, ownerUserId],
  )).rowCount;
  if (!owns) return [];
  await client.query(
    "UPDATE email_connection SET is_default = false WHERE owner_user_id = $1 AND is_default AND email_connection_id <> $2",
    [ownerUserId, id],
  );
  const { rows } = await client.query(
    "UPDATE email_connection SET is_default = true WHERE email_connection_id = $1 RETURNING email_connection_id, is_default",
    [id],
  );
  return rows;
}

/** Give the owner a default if they have none — their oldest connection. Idempotent. */
async function ensureDefaultConnection(client, ownerUserId) {
  if (!ownerUserId) return;
  await client.query(
    "UPDATE email_connection SET is_default = true " +
      "WHERE email_connection_id = (SELECT email_connection_id FROM email_connection WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 1) " +
      "AND NOT EXISTS (SELECT 1 FROM email_connection WHERE owner_user_id = $1 AND is_default)",
    [ownerUserId],
  );
}

/** Claim an unowned (legacy) mailbox for a user on reconnect. Never steals an owned one. */
async function claimConnectionIfUnowned(client, id, ownerUserId) {
  if (!ownerUserId) return;
  await client.query(
    "UPDATE email_connection SET owner_user_id = $2 WHERE email_connection_id = $1 AND owner_user_id IS NULL",
    [id, ownerUserId],
  );
}

// ── Engine: message store ────────────────────────────────────────────────
// Moved to thread.repo.js by 10731. The single-table store this file used to
// own could not express per-user read state, which a shared mailbox needs, so
// the model is now email_thread / email_message / email_message_state and its
// SQL lives with it. What remains here is connections and identities.

// ── Engine: CRM linking (Phase 3) ──
/** Match an inbound sender to a client by their recipient email (0475). */
async function findClientByEmail(client, email) {
  if (!email) return null;
  // Case-folded for the same reason thread.repo.knownParty is: the address comes
  // off the wire in whatever case the sender's client used, and a `=` comparison
  // silently declines to auto-link mail from `Client@Acme.CM`. Indexed by 10736.
  return (await client.query(
    "SELECT client_id, name FROM client_master WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1",
    [email],
  )).rows[0] || null;
}
async function setEntityRef(client, inboundId, entityRef) {
  await client.query("UPDATE email_inbound SET entity_ref = $2 WHERE email_inbound_id = $1", [inboundId, entityRef]);
}
/** Match any of the candidate tokens against a dossier's unique ref (e.g. SLAS-2026-0001). */
async function findDossierByRefs(client, refs) {
  if (!refs || !refs.length) return null;
  return (await client.query("SELECT dossier_id, ref FROM dossier_visible WHERE ref = ANY($1::text[]) LIMIT 1", [refs])).rows[0] || null;
}
// ── Engine: attachments (email_attachment, 0482) ──
const addAttachment = (client, data) => insertOne(client, "email_attachment", data);
/** Attachments on one message. `email_inbound_id` still names the column —
 *  10731 re-pointed its FK at email_message rather than renaming it, so no data
 *  moved and no other reader had to change. */
async function listAttachments(client, inboundId) {
  return (await client.query(
    "SELECT email_attachment_id, email_inbound_id, vault_id, filename, content_type, size_bytes, created_at " +
      "FROM email_attachment WHERE email_inbound_id = $1 ORDER BY created_at",
    [inboundId],
  )).rows;
}

/** Search mailable parties (clients, suppliers, employees, leads) by name or
 *  email for the compose recipient picker (WS-E8). Read-only; runs live-schema. */
async function searchRecipients(client, q, limit = 20) {
  const term = String(q || "").trim();
  if (!term) return [];
  const like = `%${term}%`;
  const { rows } = await client.query(
    `SELECT type, id, name, email FROM (
       SELECT 'client'::text AS type, client_id::text AS id, name, email::text AS email
         FROM client_master   WHERE email IS NOT NULL AND (email ILIKE $1 OR name ILIKE $1)
       UNION ALL
       SELECT 'supplier', supplier_id::text, name, email::text
         FROM supplier_master WHERE email IS NOT NULL AND (email ILIKE $1 OR name ILIKE $1)
       UNION ALL
       SELECT 'employee', employee_id::text, full_name, email::text
         FROM employee        WHERE email IS NOT NULL AND (email ILIKE $1 OR full_name ILIKE $1)
       UNION ALL
       SELECT 'lead', lead_id::text, COALESCE(contact_name, company_name), email::text
         FROM lead            WHERE email IS NOT NULL AND (email ILIKE $1 OR contact_name ILIKE $1 OR company_name ILIKE $1)
     ) r
     ORDER BY name LIMIT $2`,
    [like, limit],
  );
  return rows;
}

module.exports = {
  listIdentities, listSentLog, listInbox, updateIdentity, upsertIdentity, archiveIdentity, setBindingsForIdentity,
  insertConnection, getConnection, updateConnection, listConnections, listSyncable, findByAddress, listRenewable, setCursor, setError,
  setDefaultConnection, ensureDefaultConnection, claimConnectionIfUnowned,

  findClientByEmail, searchRecipients, findDossierByRefs,
  addAttachment, listAttachments,
};
