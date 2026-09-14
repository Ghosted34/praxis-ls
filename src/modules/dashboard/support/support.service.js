"use strict";
/**
 * Tenant-side Support & Feedback (PRD §11.2). Tickets are a tenant→Praxis
 * channel, so they live in the CENTRAL platform DB (platform.support_ticket),
 * keyed by tenant_id — the Platform Console triages them across all tenants
 * without any cross-tenant fan-out. This module only ever reads/writes rows for
 * the caller's own tenant_id (scoped by every query below).
 *
 * CONVERSATION, not status (0105). A ticket now carries a reply thread — the
 * tenant writes, Praxis answers — plus image attachments on the ticket and on
 * any reply. The internal-side mirror of this file is
 * services/platform/support.service.js; the two sides share the tables but
 * never each other's code, for the same reason a tenant query never reads
 * another tenant's rows: the platform service is the ONE place with no
 * tenant_id in its WHERE clause.
 *
 * ── REPLIES REOPEN ───────────────────────────────────────────────────────────
 * A tenant reply to a SHIPPED/DECLINED ticket means the resolution was
 * premature or new facts arrived. It goes back to NEW, where a triager sees it,
 * rather than silently dying in the lane nobody re-opens.
 *
 * ── ATTACHMENT LIFECYCLE ─────────────────────────────────────────────────────
 * An upload lands BEFORE its home exists (the tenant picks screenshots in the
 * raise form before the ticket does), so `ticket_id` is nullable until the
 * create/reply call links the ids it is handed. Uploads older than six hours
 * that still belong to no ticket are the caller's abandoned form — the next
 * upload by the same tenant reaps them.
 */
const crypto = require("node:crypto");
const path = require("node:path");
const platformDb = require("../../../services/platform/db");
const storage = require("../../../services/storage.service");

const KINDS = ["SUPPORT", "BUG", "FEATURE", "BILLING", "SECURITY", "DATA", "COMMS", "URGENT", "REQUEST"];
const RESOLVED = ["SHIPPED", "DECLINED"];

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
// A screenshot picked in a form nobody submits is an abandoned upload, not
// evidence. Six hours is longer than any realistic "think about it" and short
// enough that the orphan pile stays near zero.
const ORPHAN_MAX_AGE_HOURS = 6;

function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

async function ticketOnly(tenantId, ticketId) {
  const { rows } = await platformDb.query(
    "SELECT * FROM platform.support_ticket WHERE tenant_id=$1 AND ticket_id=$2",
    [tenantId, ticketId],
  );
  if (!rows[0]) throw err(404, "NOT_FOUND", "ticket not found");
  return rows[0];
}

/** Attachments a caller handed in must be the caller's, unlinked, and present. */
async function linkAttachments({ tenantId, ticketId, replyId = null, ids }) {
  if (!ids || !ids.length) return;
  const { rows } = await platformDb.query(
    "UPDATE platform.support_attachment SET ticket_id=$1, reply_id=$2 " +
      "WHERE attachment_id = ANY($3::uuid[]) AND tenant_id=$4 AND ticket_id IS NULL AND reply_id IS NULL " +
      "RETURNING attachment_id",
    [ticketId, replyId, ids, tenantId],
  );
  if (rows.length !== ids.length) throw err(422, "BAD_ATTACHMENT", "one of those attachments is not available");
}

async function attachmentsFor(tenantId, ticketId) {
  const { rows } = await platformDb.query(
    "SELECT attachment_id, ticket_id, reply_id, file_name, mime_type, byte_size, created_at " +
      "FROM platform.support_attachment WHERE tenant_id=$1 AND ticket_id=$2 ORDER BY created_at",
    [tenantId, ticketId],
  );
  return rows;
}

async function create(tenantId, email, { kind, title, body, context, attachmentIds }) {
  if (!KINDS.includes(kind)) throw err(422, "BAD_KIND", "unknown ticket kind");
  const { rows } = await platformDb.query(
    "INSERT INTO platform.support_ticket (tenant_id, raised_by_email, kind, title, body, context) " +
      "VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [tenantId, email || null, kind, title, body || "", context || {}],
  );
  const ticket = rows[0];
  await linkAttachments({ tenantId, ticketId: ticket.ticket_id, ids: attachmentIds });
  return ticket;
}

async function list(tenantId, { status } = {}) {
  const params = [tenantId];
  let sql =
    "SELECT st.*, r.last_reply_at " +
    "FROM platform.support_ticket st " +
    "LEFT JOIN LATERAL (" +
    "  SELECT max(created_at) AS last_reply_at FROM platform.support_ticket_reply " +
    "  WHERE ticket_id = st.ticket_id AND is_internal = false" +
    ") r ON true " +
    "WHERE st.tenant_id=$1";
  if (status) {
    params.push(status);
    sql += ` AND st.status=$${params.length}`;
  }
  // Most recently ACTIVE, not most recently filed: a ticket with a fresh
  // Praxis reply is the one to look at, not the one filed ten minutes ago
  // that nobody has touched. Internal replies do not move it — the tenant
  // never sees them, so they are not "activity" for the tenant's list.
  sql +=
    " ORDER BY GREATEST(st.created_at, coalesce(r.last_reply_at, st.created_at)) DESC " +
    "LIMIT 200";
  const { rows } = await platformDb.query(sql, params);
  return rows;
}

async function get(tenantId, ticketId) {
  const ticket = await ticketOnly(tenantId, ticketId);
  const { rows: replyRows } = await platformDb.query(
    "SELECT reply_id, author_side, author_label, body, is_internal, created_at " +
      "FROM platform.support_ticket_reply WHERE ticket_id=$1 AND is_internal = false ORDER BY created_at",
    [ticketId],
  );
  const all = await attachmentsFor(tenantId, ticketId);
  const attachments = { ticket: all.filter((a) => !a.reply_id), replies: new Map() };
  for (const a of all) {
    if (!a.reply_id) continue;
    if (!attachments.replies.has(a.reply_id)) attachments.replies.set(a.reply_id, []);
    attachments.replies.get(a.reply_id).push(a);
  }
  return {
    ...ticket,
    attachments: attachments.ticket,
    replies: replyRows.map((r) => ({ ...r, attachments: attachments.replies.get(r.reply_id) || [] })),
  };
}

/** CSAT is only meaningful once Praxis has resolved the ticket. */
async function submitCsat(tenantId, ticketId, csat) {
  await ticketOnly(tenantId, ticketId); // 404s if not this tenant's
  const { rows } = await platformDb.query(
    "UPDATE platform.support_ticket SET csat=$3 WHERE tenant_id=$1 AND ticket_id=$2 " +
      "AND status IN ('SHIPPED','DECLINED') RETURNING *",
    [tenantId, ticketId, csat],
  );
  if (!rows[0]) throw err(422, "CSAT_RESOLVED_ONLY", "CSAT can only be submitted on a resolved ticket");
  return rows[0];
}

/** The tenant adds to the thread. The internal flag does not exist here. */
async function reply(tenantId, email, ticketId, { body, attachmentIds }) {
  const ticket = await ticketOnly(tenantId, ticketId);
  const { rows } = await platformDb.query(
    "INSERT INTO platform.support_ticket_reply (ticket_id, author_side, author_label, body) " +
      "VALUES ($1, 'TENANT', $2, $3) RETURNING reply_id, author_side, author_label, body, is_internal, created_at",
    [ticketId, email || null, body],
  );
  const row = rows[0];
  await linkAttachments({ tenantId, ticketId, replyId: row.reply_id, ids: attachmentIds });

  let status = ticket.status;
  if (RESOLVED.includes(ticket.status)) {
    status = "NEW";
    await platformDb.query(
      "UPDATE platform.support_ticket SET status='NEW' WHERE ticket_id=$1",
      [ticketId],
    );
  }
  return { ...row, status, attachments: [] };
}

/**
 * Store one image from the raise form or a reply. The row goes in UNLINKED —
 * the create/reply call that follows links it (or the orphan sweep collects it).
 */
async function upload(tenantId, email, file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw err(400, "BAD_FILE", "no file in this upload");
  const ext = IMAGE_TYPES[file.mimetype];
  if (!ext) throw err(415, "BAD_FILE_TYPE", "Only image attachments (JPEG, PNG, WebP or GIF)");
  if (file.buffer.length > MAX_IMAGE_BYTES) throw err(413, "FILE_TOO_LARGE", "That image is larger than 10 MB");

  // Reap this tenant's abandoned uploads first — cheap, scoped, and never the
  // reason an upload fails.
  try {
    await platformDb.query(
      "DELETE FROM platform.support_attachment WHERE tenant_id=$1 AND ticket_id IS NULL AND reply_id IS NULL " +
        "AND created_at < now() - ($2 || ' hours')::interval",
      [tenantId, String(ORPHAN_MAX_AGE_HOURS)],
    );
  } catch {
    /* @silent:storage the sweep is best-effort — a failed reap costs an
       abandoned screenshot in storage, not the upload the user is waiting on. */
  }

  const key = `support/${tenantId}/${crypto.randomUUID()}.${ext}`;
  await storage.put(file.buffer, { key, contentType: file.mimetype });
  const fileName = path.basename(file.originalname || "").slice(0, 200) || `screenshot.${ext}`;
  const { rows } = await platformDb.query(
    "INSERT INTO platform.support_attachment (tenant_id, storage_key, file_name, mime_type, byte_size, created_by_email) " +
      "VALUES ($1,$2,$3,$4,$5,$6) " +
      "RETURNING attachment_id, ticket_id, reply_id, file_name, mime_type, byte_size, created_at",
    [tenantId, key, fileName, file.mimetype, file.buffer.length, email || null],
  );
  return rows[0];
}

/**
 * One image's bytes. A linked attachment is read through its ticket (this
 * tenant's); an unlinked one — the caller's own in-flight upload — through the
 * email it was stored under. Never through the public /media mount: this is
 * the same rule smartcomm applies to its chat images.
 */
async function attachmentBytes(tenantId, email, attachmentId) {
  const { rows } = await platformDb.query(
    "SELECT a.*, t.tenant_id AS ticket_tenant " +
      "FROM platform.support_attachment a " +
      "LEFT JOIN platform.support_ticket t ON t.ticket_id = a.ticket_id " +
      "WHERE a.attachment_id=$1",
    [attachmentId],
  );
  const row = rows[0];
  if (!row) throw err(404, "NOT_FOUND", "attachment not found");
  const ownedByCaller =
    row.tenant_id === tenantId &&
    (row.ticket_id
      ? row.ticket_tenant === tenantId
      : !row.created_by_email || String(row.created_by_email).toLowerCase() === String(email || "").toLowerCase());
  if (!ownedByCaller) throw err(404, "NOT_FOUND", "attachment not found");
  const buffer = await storage.get(row.storage_key);
  return { buffer, mime: row.mime_type, name: row.file_name };
}

module.exports = {
  KINDS,
  MAX_IMAGE_BYTES,
  MAX_ATTACHMENTS,
  create,
  list,
  get,
  submitCsat,
  reply,
  upload,
  attachmentBytes,
};
