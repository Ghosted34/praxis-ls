/**
 * SQL for drafts, staged attachments and the send queue.
 *
 * ── EVERY QUERY HERE IS SCOPED BY user_id, WITHOUT EXCEPTION ────────────────
 *
 * A draft is the most private thing in a mailbox. It is what somebody is still
 * deciding whether to say, and in a SHARED mailbox — where several people have
 * a live grant on the same connection — mailbox access is emphatically NOT
 * authority to read a colleague's unsent words. So the scope here is the AUTHOR,
 * not the mailbox, and there is no function in this file that takes a draft id
 * without also taking the user it must belong to.
 *
 * The queue is scoped the same way for reads, and deliberately NOT for the
 * flusher: the worker drains everything due regardless of who wrote it, because
 * by then the person has approved the send and gone.
 */
"use strict";

const { getById } = require("../../../shared/db/query-helpers");

/* ── Drafts ───────────────────────────────────────────────────────────────── */

const DRAFT_COLS = `email_draft_id, user_id, email_connection_id, email_thread_id,
  reply_to_message_id, kind, to_address::text[] AS to_address, cc_address::text[] AS cc_address,
  bcc_address::text[] AS bcc_address, subject, body_json, body_html, body_text,
  send_point_key, created_at, updated_at`;

const getDraft = (client, userId, id) =>
  client.query(
    `SELECT ${DRAFT_COLS} FROM email_draft WHERE email_draft_id = $1 AND user_id = $2`,
    [id, userId],
  ).then((r) => r.rows[0] || null);

const listDrafts = (client, userId, { threadId = null, limit = 50 } = {}) =>
  client.query(
    `SELECT ${DRAFT_COLS} FROM email_draft
      WHERE user_id = $1 AND ($2::uuid IS NULL OR email_thread_id = $2)
      ORDER BY updated_at DESC LIMIT $3`,
    [userId, threadId, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  ).then((r) => r.rows);

/** The columns a draft update may touch, and how each is bound. */
const DRAFT_FIELDS = {
  email_connection_id: "$", email_thread_id: "$", reply_to_message_id: "$", kind: "$",
  to_address: "$::citext[]", cc_address: "$::citext[]", bcc_address: "$::citext[]",
  subject: "$", body_json: "$", body_html: "$", body_text: "$", send_point_key: "$",
};

/**
 * Create or update the one draft for this (user, reply target, kind).
 *
 * ── AN UPDATE TOUCHES ONLY THE FIELDS THE CALLER ACTUALLY SENT ──────────────
 *
 * The composer autosaves as people type, and the natural thing for it to send is
 * the field that changed. An UPDATE that wrote every column would then clear the
 * recipients and the mailbox every time someone edited the subject — and the
 * failure is invisible until a message is addressed to nobody. So the SET clause
 * is built from the keys that are PRESENT.
 *
 * `undefined` means "not provided"; `null` and `[]` mean "explicitly cleared".
 * Collapsing those two would make it impossible to delete a subject or remove
 * the last recipient, which is the opposite bug.
 *
 * ── A REPLY UPSERTS ON THE PARTIAL UNIQUE INDEX FROM 10738 ──────────────────
 *
 * So a burst of autosaves that races itself can only ever produce one row. A NEW
 * draft has no reply target and therefore no conflict target, which is why the
 * service hands its id back to the client after the first save.
 */
async function upsertDraft(client, userId, d = {}) {
  const provided = Object.keys(DRAFT_FIELDS).filter((k) => d[k] !== undefined);

  if (d.email_draft_id) {
    // Nothing to change but the timestamp — a keepalive from an idle composer.
    const params = [userId, d.email_draft_id];
    const sets = provided.map((k) => {
      params.push(d[k]);
      return `${k} = ${DRAFT_FIELDS[k].replace("$", `$${params.length}`)}`;
    });
    const { rows } = await client.query(
      `UPDATE email_draft SET ${[...sets, "updated_at = now()"].join(", ")}
        WHERE email_draft_id = $2 AND user_id = $1
        RETURNING ${DRAFT_COLS}`,
      params,
    );
    if (rows[0]) return rows[0];
    // Fell through: the id is not this user's, or was discarded from another
    // tab. Insert instead of failing — losing what someone just typed because a
    // row vanished underneath them is the worst possible outcome here.
  }

  const values = [
    userId, d.email_connection_id || null, d.email_thread_id || null,
    d.reply_to_message_id || null, d.kind || "NEW",
    d.to_address || [], d.cc_address || [], d.bcc_address || [],
    d.subject ?? null, d.body_json ?? null, d.body_html ?? null, d.body_text ?? null,
    d.send_point_key || null,
  ];
  const INSERT = `INSERT INTO email_draft
       (user_id, email_connection_id, email_thread_id, reply_to_message_id, kind,
        to_address, cc_address, bcc_address, subject, body_json, body_html, body_text, send_point_key)
     VALUES ($1,$2,$3,$4,$5,$6::citext[],$7::citext[],$8::citext[],$9,$10,$11,$12,$13)`;

  if (d.reply_to_message_id) {
    // Only the provided fields are overwritten on conflict, for the same reason
    // the UPDATE above is selective.
    const onConflict = provided.length
      ? provided.map((k) => `${k} = EXCLUDED.${k}`).join(", ")
      : "updated_at = now()";
    const { rows } = await client.query(
      `${INSERT}
       ON CONFLICT (user_id, reply_to_message_id, kind) WHERE reply_to_message_id IS NOT NULL
         DO UPDATE SET ${onConflict}, updated_at = now()
       RETURNING ${DRAFT_COLS}`,
      values,
    );
    return rows[0];
  }

  const { rows } = await client.query(`${INSERT} RETURNING ${DRAFT_COLS}`, values);
  return rows[0];
}

const deleteDraft = (client, userId, id) =>
  client.query(
    "DELETE FROM email_draft WHERE email_draft_id = $1 AND user_id = $2 RETURNING email_draft_id",
    [id, userId],
  ).then((r) => r.rows[0] || null);

/* ── Staged attachments ───────────────────────────────────────────────────── */

const ATTACH_COLS = `email_attachment_id, email_message_id, email_draft_id, vault_id, filename,
  content_type, size_bytes, direction, disposition, content_id, checksum_sha256, created_at`;

const addAttachment = (client, a = {}) =>
  client.query(
    `INSERT INTO email_attachment
       (email_draft_id, email_message_id, vault_id, filename, content_type, size_bytes,
        direction, disposition, content_id, checksum_sha256, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${ATTACH_COLS}`,
    [
      a.email_draft_id || null, a.email_message_id || null, a.vault_id || null,
      a.filename || null, a.content_type || null, a.size_bytes || null,
      a.direction || "OUT", a.disposition || "attachment",
      a.content_id || null, a.checksum_sha256 || null, a.created_by || null,
    ],
  ).then((r) => r.rows[0]);

const listDraftAttachments = (client, draftId) =>
  client.query(
    `SELECT ${ATTACH_COLS} FROM email_attachment WHERE email_draft_id = $1 ORDER BY created_at`,
    [draftId],
  ).then((r) => r.rows);

/** The sum, not the count — the 25 MB cap is on the whole message (Q9). */
const draftAttachmentBytes = (client, draftId) =>
  client.query(
    "SELECT COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM email_attachment WHERE email_draft_id = $1",
    [draftId],
  ).then((r) => Number(r.rows[0].bytes));

/**
 * Remove a staged attachment, but only from a draft the caller owns.
 *
 * The join to `email_draft` is the authorisation: without it, an attachment id
 * is enough to detach a file from somebody else's unsent message.
 */
const removeDraftAttachment = (client, userId, draftId, attachmentId) =>
  client.query(
    `DELETE FROM email_attachment a
      USING email_draft d
      WHERE a.email_draft_id = d.email_draft_id
        AND d.user_id = $1 AND d.email_draft_id = $2 AND a.email_attachment_id = $3
      RETURNING a.email_attachment_id, a.vault_id`,
    [userId, draftId, attachmentId],
  ).then((r) => r.rows[0] || null);

/**
 * Re-point a draft's attachments at the message that was just sent.
 *
 * One UPDATE, so the rows are never briefly owned by neither — the one-owner
 * CHECK from 10737 would reject that anyway, which is the point of having it.
 */
const attachToMessage = (client, draftId, messageId) =>
  client.query(
    `UPDATE email_attachment SET email_message_id = $2, email_draft_id = NULL
      WHERE email_draft_id = $1 RETURNING email_attachment_id`,
    [draftId, messageId],
  ).then((r) => r.rows.length);

/* ── The send queue ───────────────────────────────────────────────────────── */

const QUEUE_COLS = `email_send_queue_id, email_connection_id, user_id, email_draft_id,
  email_thread_id, payload, status, release_at, attempts, last_error, error_code,
  sent_message_id, idempotency_key, created_at, updated_at, sent_at`;

const enqueue = (client, q = {}) =>
  client.query(
    `INSERT INTO email_send_queue
       (email_connection_id, user_id, email_draft_id, email_thread_id, payload, status,
        release_at, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,'HELD',$6,$7)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
       SET updated_at = now()
     RETURNING ${QUEUE_COLS}`,
    [
      q.email_connection_id, q.user_id || null, q.email_draft_id || null,
      q.email_thread_id || null, q.payload, q.release_at, q.idempotency_key || null,
    ],
  ).then((r) => r.rows[0]);

const getQueued = (client, userId, id) =>
  client.query(
    `SELECT ${QUEUE_COLS} FROM email_send_queue
      WHERE email_send_queue_id = $1 AND ($2::uuid IS NULL OR user_id = $2)`,
    [id, userId],
  ).then((r) => r.rows[0] || null);

const listQueued = (client, userId, { limit = 20 } = {}) =>
  client.query(
    `SELECT ${QUEUE_COLS} FROM email_send_queue
      WHERE user_id = $1 AND status IN ('HELD','QUEUED','SENDING','FAILED')
      ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 20, 1), 100)],
  ).then((r) => r.rows);

/**
 * UNDO. The whole race lives in this one statement.
 *
 * `WHERE status = 'HELD'` and a rowcount check: if the flusher already flipped
 * the row to SENDING, zero rows match and the caller is told the message has
 * gone. There is no window in which both this and the flusher believe they won,
 * because Postgres decides — not a timer in a browser that may be closed,
 * asleep, or on a different device from the one that pressed Send.
 */
const cancel = (client, userId, id) =>
  client.query(
    `UPDATE email_send_queue SET status = 'CANCELLED', updated_at = now()
      WHERE email_send_queue_id = $1 AND status = 'HELD'
        AND ($2::uuid IS NULL OR user_id = $2)
      RETURNING ${QUEUE_COLS}`,
    [id, userId],
  ).then((r) => r.rows[0] || null);

/**
 * Claim the due rows, atomically.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several workers drain the queue at once
 * without two of them sending the same message: a row another worker is already
 * holding is skipped rather than waited for. The UPDATE and the SELECT are one
 * statement, so there is no gap between seeing a row and owning it.
 */
const claimDue = (client, { limit = 20 } = {}) =>
  client.query(
    `UPDATE email_send_queue q SET status = 'SENDING', attempts = q.attempts + 1, updated_at = now()
      WHERE q.email_send_queue_id IN (
        SELECT email_send_queue_id FROM email_send_queue
         WHERE status IN ('HELD','QUEUED') AND release_at <= now()
         ORDER BY release_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1)
      RETURNING ${QUEUE_COLS}`,
    [Math.min(Math.max(Number(limit) || 20, 1), 100)],
  ).then((r) => r.rows);

const markSent = (client, id, messageId) =>
  client.query(
    `UPDATE email_send_queue
        SET status = 'SENT', sent_message_id = $2, sent_at = now(), last_error = NULL,
            error_code = NULL, updated_at = now()
      WHERE email_send_queue_id = $1 RETURNING ${QUEUE_COLS}`,
    [id, messageId || null],
  ).then((r) => r.rows[0] || null);

/**
 * A failed attempt goes back to QUEUED with a later release, or to FAILED.
 *
 * The decision is made by the caller and passed in as `retryAt`, because how
 * long to wait depends on WHY it failed — a rejected sender address will never
 * succeed on a retry, and retrying it three times just delays telling the user
 * something they have to fix.
 */
const markAttemptFailed = (client, id, { message, code = null, retryAt = null } = {}) =>
  client.query(
    `UPDATE email_send_queue
        SET status = CASE WHEN $4::timestamptz IS NULL THEN 'FAILED' ELSE 'QUEUED' END,
            release_at = COALESCE($4::timestamptz, release_at),
            last_error = $2, error_code = $3, updated_at = now()
      WHERE email_send_queue_id = $1 RETURNING ${QUEUE_COLS}`,
    [id, String(message || "").slice(0, 2000), code, retryAt],
  ).then((r) => r.rows[0] || null);

/**
 * Rows left in SENDING by a worker that died mid-flight.
 *
 * A process killed between claiming a row and recording its outcome leaves it
 * stuck forever: nothing else will claim it, because it is no longer in HELD or
 * QUEUED. Requeued only after a generous stall window, and only while attempts
 * remain — a message that may or may not have been sent is requeued at the risk
 * of a duplicate, which is the right trade for mail (the alternative is silently
 * never sending it), but not one to make repeatedly.
 */
const requeueStalled = (client, { stalledMinutes = 10, maxAttempts = 3 } = {}) =>
  client.query(
    `UPDATE email_send_queue
        SET status = 'QUEUED', release_at = now(), updated_at = now(),
            last_error = COALESCE(last_error, 'Requeued after the sending worker stopped mid-flight')
      WHERE status = 'SENDING'
        AND updated_at < now() - ($1 || ' minutes')::interval
        AND attempts < $2
      RETURNING email_send_queue_id`,
    [String(Math.max(Number(stalledMinutes) || 10, 1)), Math.max(Number(maxAttempts) || 3, 1)],
  ).then((r) => r.rows.map((x) => x.email_send_queue_id));

module.exports = {
  getDraft, listDrafts, upsertDraft, deleteDraft,
  addAttachment, listDraftAttachments, draftAttachmentBytes, removeDraftAttachment, attachToMessage,
  enqueue, getQueued, listQueued, cancel, claimDue, markSent, markAttemptFailed, requeueStalled,
  byId: (client, id) => getById(client, "email_send_queue", "email_send_queue_id", id),
};
