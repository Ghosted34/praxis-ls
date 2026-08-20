/**
 * Internal notes. Structurally cannot be sent: compose.js never sees this table.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { emitEvent } = require("../../../shared/events/emit");
const notify = require("../../notification/notification.service");

const list = (client, threadId) =>
  client.query(
    `SELECT n.*, u.full_name AS author_name
       FROM email_thread_note n
       JOIN app_user u ON u.user_id = n.author_user_id
      WHERE n.email_thread_id = $1 AND n.deleted_at IS NULL
      ORDER BY n.created_at`,
    [threadId],
  ).then((r) => r.rows);

async function create(client, { threadId, body, mentions = [], actor = {} }) {
  if (!actor.user_id) throw new AppError("VALIDATION_ERROR", "a note needs an author", 422);
  const { rows } = await client.query(
    `INSERT INTO email_thread_note (email_thread_id, author_user_id, body)
     VALUES ($1,$2,$3) RETURNING *`,
    [threadId, actor.user_id, body],
  );
  const note = rows[0];
  const unique = [...new Set(mentions.filter(Boolean))];
  for (const userId of unique) {
    const { rows: users } = await client.query(
      `SELECT user_id, full_name FROM app_user WHERE user_id = $1 AND status='ACTIVE'`,
      [userId],
    );
    if (!users[0]) {
      throw new AppError(
        "NO_USER_ACCOUNT",
        "That employee has no user account, so they cannot be mentioned.",
        422,
      );
    }
    await client.query(
      `INSERT INTO mention (source_kind, source_ref, context_ref, mentioned_user_id, author_user_id, excerpt)
       VALUES ('MAIL_NOTE', $1, $2, $3, $4, $5)`,
      [`email_thread_note:${note.email_thread_note_id}`, `email_thread:${threadId}`, userId, actor.user_id, body.slice(0, 180)],
    );
    await notify.notify(client, {
      userId,
      eventTypeKey: "mention.created",
      title: "You were mentioned on a mail thread",
      body: body.slice(0, 180),
      entityRef: `email_thread:${threadId}`,
      category: "system",
      dedupeKey: `MENTION:email_thread_note:${note.email_thread_note_id}:${userId}`,
    });
  }
  await emitEvent(client, {
    eventTypeKey: "email.note.created", moduleKey: "MOD-72",
    entityRef: `email_thread:${threadId}`, actorUserId: actor.user_id,
  }).catch(() => { /* @silent:storage the note row is the outcome */ });
  return note;
}

module.exports = { list, create };
