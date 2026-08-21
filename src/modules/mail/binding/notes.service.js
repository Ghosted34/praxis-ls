/**
 * Internal notes. Structurally cannot be sent: compose.js never sees this table.
 *
 * Mentions fan out through `mention.service`, which owns the three-channel rule
 * (§7.4). This file writes the note and the `mention` rows; it does not decide
 * how a person is told, because that decision has to be the same wherever the
 * mention primitive is reused (chat and dossier notes are the declared next
 * users of the same table).
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { emitEvent } = require("../../../shared/events/emit");
const mention = require("./mention.service");

const list = (client, threadId) =>
  client.query(
    `SELECT n.*, u.full_name AS author_name
       FROM email_thread_note n
       JOIN app_user u ON u.user_id = n.author_user_id
      WHERE n.email_thread_id = $1 AND n.deleted_at IS NULL
      ORDER BY n.created_at`,
    [threadId],
  ).then((r) => r.rows);

/**
 * The thread's subject and the author's display name.
 *
 * Fetched once per note rather than once per mention: a note that names four
 * colleagues is still one note, and this is the only reason the chat card can
 * read "Blake mentioned you on «Re: BL for SLAS-2026-0042»" instead of naming a
 * uuid.
 */
async function mentionContext(client, threadId, authorUserId) {
  const { rows } = await client.query(
    `SELECT (SELECT subject FROM email_thread WHERE email_thread_id = $1) AS subject,
            (SELECT full_name FROM app_user WHERE user_id = $2) AS author_name`,
    [threadId, authorUserId],
  );
  return rows[0] || { subject: null, author_name: null };
}

async function create(client, { threadId, body, mentions = [], actor = {} }) {
  if (!actor.user_id) throw new AppError("VALIDATION_ERROR", "a note needs an author", 422);
  const { rows } = await client.query(
    `INSERT INTO email_thread_note (email_thread_id, author_user_id, body)
     VALUES ($1,$2,$3) RETURNING *`,
    [threadId, actor.user_id, body],
  );
  const note = rows[0];
  const unique = [...new Set(mentions.filter(Boolean))];
  const context = unique.length ? await mentionContext(client, threadId, actor.user_id) : null;

  for (const userId of unique) {
    // Throws NO_USER_ACCOUNT rather than skipping. §7.4: a silent no-op mention
    // is worse than none, because the author believes they reached someone.
    const target = await mention.resolveMentionable(client, userId);
    await client.query(
      `INSERT INTO mention (source_kind, source_ref, context_ref, mentioned_user_id, author_user_id, excerpt)
       VALUES ('MAIL_NOTE', $1, $2, $3, $4, $5)`,
      [`email_thread_note:${note.email_thread_note_id}`, `email_thread:${threadId}`, userId, actor.user_id, body.slice(0, 180)],
    );
    await mention.fanOut(client, {
      noteId: note.email_thread_note_id,
      threadId,
      subject: context && context.subject,
      excerpt: body.slice(0, 180),
      author: { user_id: actor.user_id, full_name: context && context.author_name },
      target,
    });
  }

  await emitEvent(client, {
    eventTypeKey: "email.note.created", moduleKey: "MOD-72",
    entityRef: `email_thread:${threadId}`, actorUserId: actor.user_id,
  }).catch(() => { /* @silent:storage the note row is the outcome */ });
  return note;
}

module.exports = { list, create, mentionContext };
