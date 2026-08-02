/** Mail repository — per-purpose sender identities + the outbound send log
 *  (read-only view), PLUS the provider-agnostic engine's connections and the
 *  enriched inbound/thread store (0480/0481). All SQL lives here. */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../shared/db/query-helpers");

async function listIdentities(client) {
  const { rows } = await client.query(
    "SELECT email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active " +
      "FROM email_identity ORDER BY purpose",
  );
  return rows;
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

async function listInbox(client, { limit = 100, offset = 0, identityId = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 100, 1), 500), Number(offset) || 0];
  let where = "";
  if (identityId) { params.push(identityId); where = "WHERE b.email_identity_id = $3"; }
  const { rows } = await client.query(
    "SELECT b.email_inbound_id, b.email_identity_id, b.from_address, b.to_address, b.subject, " +
      "b.body_preview, b.entity_ref, b.is_read, b.received_at, i.purpose " +
      "FROM email_inbound b LEFT JOIN email_identity i ON i.email_identity_id = b.email_identity_id " +
      where + " ORDER BY b.received_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function updateIdentity(client, id, fields) {
  const allow = ["from_name", "reply_to", "smtp_host", "smtp_port", "is_active"];
  const keys = Object.keys(fields).filter((k) => allow.includes(k));
  if (!keys.length) return null;
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query(
    "UPDATE email_identity SET " + set + " WHERE email_identity_id = $1 RETURNING email_identity_id, purpose, from_address, from_name, reply_to, smtp_host, smtp_port, is_active",
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
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

// ── Engine: connections (email_connection, 0480) ──
const insertConnection = (client, data) => insertOne(client, "email_connection", data);
const getConnection = (client, id) => getById(client, "email_connection", "email_connection_id", id);
const updateConnection = (client, id, patch) => updateOne(client, "email_connection", "email_connection_id", id, patch);

async function listConnections(client, q = {}) {
  const { limit, offset } = page(q);
  const { rows } = await client.query(
    "SELECT email_connection_id, email_address, provider, display_name, status, last_sync_at, last_error, " +
      "imap_host, imap_port, smtp_host, smtp_port, auth_user, created_at " +
      "FROM email_connection ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset],
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

// ── Engine: inbound / thread store (email_inbound, enriched by 0481) ──
/** Insert a normalized message, deduped on (connection, external_message_id).
 *  Returns the new row, or null when it was a duplicate. */
async function insertInbound(client, row) {
  const { rows } = await client.query(
    "INSERT INTO email_inbound " +
      "(email_connection_id, email_identity_id, external_message_id, thread_key, direction, " +
      " from_address, to_address, subject, body_preview, body_html, body_text, in_reply_to, is_read, received_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) " +
      "ON CONFLICT (email_connection_id, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING " +
      "RETURNING email_inbound_id, thread_key",
    [
      row.email_connection_id, row.email_identity_id || null, row.external_message_id, row.thread_key, row.direction || "IN",
      row.from_address || "unknown@unknown", row.to_address || null, row.subject || null,
      String(row.body_text || row.body_preview || "").slice(0, 500), row.body_html || null, row.body_text || null,
      row.in_reply_to || null, row.is_read === true, row.received_at || new Date(),
    ],
  );
  return rows[0] || null;
}

async function listInboundByConnection(client, { connectionId = null, limit = 50, before = null } = {}) {
  const params = [Math.min(Math.max(Number(limit) || 50, 1), 200)];
  let where = "1=1";
  if (connectionId) { params.push(connectionId); where += ` AND email_connection_id = $${params.length}`; }
  if (before) { params.push(before); where += ` AND received_at < $${params.length}`; }
  const { rows } = await client.query(
    "SELECT email_inbound_id, email_connection_id, external_message_id, thread_key, direction, " +
      "from_address, to_address, subject, body_preview, is_read, received_at " +
      `FROM email_inbound WHERE ${where} ORDER BY received_at DESC LIMIT $1`,
    params,
  );
  return rows;
}

const getInbound = (client, id) => getById(client, "email_inbound", "email_inbound_id", id);
async function markInboundRead(client, id) {
  const { rows } = await client.query("UPDATE email_inbound SET is_read = true WHERE email_inbound_id = $1 RETURNING email_inbound_id", [id]);
  return rows[0] || null;
}

// ── Engine: CRM linking (Phase 3) ──
/** Match an inbound sender to a client by their recipient email (0475). */
async function findClientByEmail(client, email) {
  if (!email) return null;
  return (await client.query(
    "SELECT client_id, name FROM client_master WHERE email = $1 ORDER BY created_at LIMIT 1",
    [email],
  )).rows[0] || null;
}
async function setEntityRef(client, inboundId, entityRef) {
  await client.query("UPDATE email_inbound SET entity_ref = $2 WHERE email_inbound_id = $1", [inboundId, entityRef]);
}
/** Match any of the candidate tokens against a dossier's unique ref (e.g. SLAS-2026-0001). */
async function findDossierByRefs(client, refs) {
  if (!refs || !refs.length) return null;
  return (await client.query("SELECT dossier_id, ref FROM dossier WHERE ref = ANY($1::text[]) LIMIT 1", [refs])).rows[0] || null;
}
/** All mail (in + out) tied to an entity_ref, e.g. 'client:<uuid>' — a timeline. */
async function timelineByEntity(client, entityRef, { limit = 100 } = {}) {
  return (await client.query(
    "SELECT email_inbound_id, email_connection_id, thread_key, direction, from_address, to_address, subject, " +
      "body_preview, is_read, entity_ref, received_at " +
      "FROM email_inbound WHERE entity_ref = $1 ORDER BY received_at DESC LIMIT $2",
    [entityRef, Math.min(Math.max(Number(limit) || 100, 1), 500)],
  )).rows;
}

// ── Engine: attachments (email_attachment, 0482) ──
const addAttachment = (client, data) => insertOne(client, "email_attachment", data);
async function listAttachments(client, inboundId) {
  return (await client.query(
    "SELECT email_attachment_id, email_inbound_id, vault_id, filename, content_type, size_bytes, created_at " +
      "FROM email_attachment WHERE email_inbound_id = $1 ORDER BY created_at",
    [inboundId],
  )).rows;
}

module.exports = {
  listIdentities, listSentLog, listInbox, updateIdentity, upsertIdentity,
  insertConnection, getConnection, updateConnection, listConnections, listSyncable, findByAddress, listRenewable, setCursor, setError,
  insertInbound, listInboundByConnection, getInbound, markInboundRead,
  findClientByEmail, findDossierByRefs, setEntityRef, timelineByEntity,
  addAttachment, listAttachments,
};
