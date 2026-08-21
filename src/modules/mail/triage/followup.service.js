/**
 * Follow-ups, fired (§9.3).
 *
 * `POST /mail/threads/:id/snooze` and `/followup` have written `email_followup`
 * rows since the merge. Nothing has ever read them. A user who asked for a
 * thread back in three days got a 201, a row, and silence — the single worst
 * kind of broken feature, because it looks like it worked and the user stops
 * keeping their own note.
 *
 * ── THESE ARE REMINDERS, NOT SENDS ──────────────────────────────────────────
 *
 * Q24 forbids auto-send and §9.3 extends that to sequences explicitly: a
 * SEQUENCE_STEP is a reminder to a human on day 3, day 7 and day 14, never a
 * message that goes out on its own. Nothing in this file writes to the send
 * queue, and `tests/unit/mail-followup-sweep.test.js` asserts that it stays
 * that way.
 */
"use strict";

const notify = require("../../notification/notification.service");
const { emitEvent } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

const COPY = {
  SNOOZE: {
    title: "Snoozed conversation is back",
    body: (s) => (s ? `«${s}» is back in your inbox.` : "A snoozed conversation is back in your inbox."),
  },
  NO_REPLY: {
    title: "Still no reply",
    body: (s) => (s ? `No reply yet on «${s}».` : "A conversation you were watching has had no reply."),
  },
  SEQUENCE_STEP: {
    title: "Follow-up due",
    body: (s) => (s ? `Time to follow up on «${s}».` : "A follow-up you scheduled is due."),
  },
};

/**
 * Fire everything due, once.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` and flipped to FIRED in the
 * same statement that selects them, so two workers — or one worker whose
 * previous tick has not finished — cannot both notify for the same row. This is
 * the same discipline `outbox.service.flush` uses on the send queue, and for
 * the same reason: at-least-once delivery of a JOB must not become
 * more-than-once delivery of a NOTIFICATION.
 */
async function sweep(client, { now = new Date(), limit = 200 } = {}) {
  const { rows: dueRows } = await client.query(
    `WITH claimed AS (
       SELECT email_followup_id FROM email_followup
        WHERE status = 'PENDING' AND due_at <= $1
        ORDER BY due_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     UPDATE email_followup f SET status = 'FIRED'
       FROM claimed WHERE f.email_followup_id = claimed.email_followup_id
     RETURNING f.email_followup_id, f.email_thread_id, f.user_id, f.kind, f.note`,
    [now, Math.min(Math.max(Number(limit) || 200, 1), 500)],
  );
  if (!dueRows.length) return { fired: 0 };

  const subjects = await subjectsFor(client, dueRows.map((r) => r.email_thread_id));
  let fired = 0;
  for (const row of dueRows) {
    try {
      const copy = COPY[row.kind] || COPY.SEQUENCE_STEP;
      const subject = subjects.get(row.email_thread_id) || null;
      await notify.notify(client, {
        userId: row.user_id,
        eventTypeKey: "mail.followup.due",
        title: copy.title,
        body: row.note ? `${copy.body(subject)} — ${row.note}` : copy.body(subject),
        entityRef: `email_thread:${row.email_thread_id}`,
        // The row id, not the thread id: a user may legitimately set three
        // reminders on one thread and is entitled to all three.
        dedupeKey: `FOLLOWUP:${row.email_followup_id}:${row.user_id}`,
      });
      await emitEvent(client, {
        eventTypeKey: "mail.followup.fired",
        moduleKey: "MOD-72",
        entityRef: `email_thread:${row.email_thread_id}`,
        actorUserId: row.user_id,
        payload: { kind: row.kind, followup: row.email_followup_id },
      }).catch(() => { /* @silent:storage the FIRED row is the record */ });
      fired += 1;
    } catch (err) {
      // The row is already FIRED. Re-opening it here would re-notify on the
      // next tick and, since the failure is usually the notification service
      // itself, would do so forever.
      logger.warn({ err, followup: row.email_followup_id }, "[mail] follow-up notification failed");
    }
  }
  return { fired };
}

async function subjectsFor(client, threadIds) {
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await client.query(
    `SELECT email_thread_id, subject FROM email_thread WHERE email_thread_id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.email_thread_id, r.subject]));
}

/**
 * A client reply cancels the boomerang (§9.3, "silently").
 *
 * Also exported here so the cancel rule has ONE definition, even though the
 * ingest loop currently inlines the same UPDATE — see the wiring test, which
 * holds the two to the same shape.
 */
const cancelOnReply = (client, threadId) =>
  client.query(
    `UPDATE email_followup SET status = 'CANCELLED'
      WHERE email_thread_id = $1 AND status = 'PENDING'
        AND cancel_on_reply = true AND kind IN ('NO_REPLY','SEQUENCE_STEP')
      RETURNING email_followup_id`,
    [threadId],
  ).then((r) => ({ cancelled: r.rows.length }));

module.exports = { sweep, cancelOnReply, subjectsFor, COPY };
