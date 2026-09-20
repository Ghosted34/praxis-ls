/**
 * Smart Comms Calls (PR-1) — repository. All SQL for call state and
 * per-user last-seen presence lives here, per the module convention.
 *
 * The state machine is owned by smartcomm.call.service.js; this file only
 * reads and writes rows. Transitions are single UPDATEs guarded by the
 * row's CURRENT status, so two racing transitions (a hangup arriving the
 * same instant as the 30-minute cap) cannot both win: the second matches
 * zero rows and the service treats that as "already moved on".
 */
"use strict";

const { atomically } = require("../../shared/db/tx");

const ACTIVE_STATUSES = ["RINGING", "IN_CALL"];

/** The user's active call (either role), or null. For NAMING the busy error;
 *  the partial unique indexes — not this SELECT — are the actual guard,
 *  because a pre-check can race itself between the SELECT and the INSERT. */
async function findActiveCall(client, userId) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call
     WHERE (caller_id = $1 OR callee_id = $1) AND status IN ('RINGING','IN_CALL')
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

/** Insert a RINGING call. Returns `{ call }` on success or
 *  `{ call: null, busyWith }` when a partial unique index rejected the insert
 *  because one of the two users is already on a call (guide D8). The service
 *  decides which of the two users it was and says so in the error. */
async function insertCall(client, { groupId, callerId, calleeId }) {
  try {
    const { rows } = await client.query(
      `INSERT INTO comms_call (group_id, caller_id, callee_id, status)
       VALUES ($1, $2, $3, 'RINGING')
       RETURNING *`,
      [groupId, callerId, calleeId],
    );
    return { call: rows[0], busyWith: null };
  } catch (err) {
    if (err && err.code === "23505") {
      const busyWith =
        (await findActiveCall(client, callerId)) || (await findActiveCall(client, calleeId));
      return { call: null, busyWith };
    }
    throw err;
  }
}

async function findCall(client, callId) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call WHERE call_id = $1`,
    [callId],
  );
  return rows[0] || null;
}

/** Guarded transition: only moves the row if it is still `fromStatus`.
 *  Returns the updated row, or null when someone got there first. */
async function transition(client, { callId, fromStatus, status, fields = {} }) {
  const setCols = ["status = $" + 3];
  const params = [callId, fromStatus, status];
  for (const [col, value] of Object.entries(fields)) {
    params.push(value);
    setCols.push(`${col} = $${params.length}`);
  }
  const { rows } = await client.query(
    `UPDATE comms_call SET ${setCols.join(", ")}
     WHERE call_id = $1 AND status = $2
     RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/**
 * Record the FIRST channel a ring landed on (PR-3, §4.6 / §7.4.4).
 *
 * `WHERE ring_ack_at IS NULL` is the whole concurrency story, and it is the
 * same shape as `transition` above: two devices of the same callee (desk tab
 * and phone) can ack within milliseconds of each other, and "which channel
 * landed" is a fact about the ring, not about whichever socket spoke last. The
 * guarded UPDATE means exactly one ack matches; the loser is told by the empty
 * result that it did not, and can then stand down its own ring UI without
 * re-broadcasting the ack — which is what a second writer would do.
 *
 * Returns the updated row, or null when an ack already existed.
 */
async function markRingAck(client, { callId, channel }) {
  const { rows } = await client.query(
    `UPDATE comms_call
     SET ring_ack_channel = $2,
         ring_ack_at = now()
     WHERE call_id = $1
       AND ring_ack_at IS NULL
     RETURNING *`,
    [callId, channel],
  );
  return rows[0] || null;
}

/**
 * Claim the push escalation for this call, atomically.
 *
 * The delayed job is queued with a static id, so BullMQ de-duplicates the
 * common case — but "the queue delivered this twice" (a retry after a worker
 * died between the send and the ack of the job) must not become two pushes to a
 * phone that is already ringing. The `WHERE ring_push_sent_at IS NULL` is the
 * claim: exactly one caller receives the row and does the send.
 */
async function markRingPushSent(client, callId) {
  const { rows } = await client.query(
    `UPDATE comms_call
     SET ring_push_sent_at = now()
     WHERE call_id = $1
       AND ring_push_sent_at IS NULL
     RETURNING *`,
    [callId],
  );
  return rows[0] || null;
}

/** Who is the other participant of this call, relative to `userId`. */
async function otherParticipant(client, { callId, userId }) {
  const { rows } = await client.query(
    `SELECT CASE WHEN caller_id = $2 THEN callee_id ELSE caller_id END AS user_id
     FROM comms_call WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)`,
    [callId, userId],
  );
  return rows[0] || null;
}

/** Does `userId` participate in this call at all (any status)? */
async function isParticipant(client, { callId, userId }) {
  const { rows } = await client.query(
    `SELECT 1 AS ok FROM comms_call
     WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)`,
    [callId, userId],
  );
  return rows.length > 0;
}

/** The other member of a DIRECT channel (the dial target when the icon is
 *  on the channel header). Null for non-DIRECT channels or channels with
 *  more than one other member — the header icon only renders on DIRECT. */
async function directPartner(client, { groupId, userId }) {
  const { rows } = await client.query(
    `SELECT m.user_id
     FROM comms_group g
     JOIN comms_member m ON m.group_id = g.group_id
     WHERE g.group_id = $1 AND g.kind = 'DIRECT' AND m.user_id <> $2
     LIMIT 1`,
    [groupId, userId],
  );
  return rows[0] || null;
}

async function listCallsForUser(client, userId, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT c.*, g.name AS channel_name,
            cu.full_name AS caller_name,
            bu.full_name AS callee_name
     FROM comms_call c
     JOIN comms_group g ON g.group_id = c.group_id
     JOIN app_user cu ON cu.user_id = c.caller_id
     JOIN app_user bu ON bu.user_id = c.callee_id
     WHERE c.caller_id = $1 OR c.callee_id = $1
     ORDER BY c.started_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(200, limit))],
  );
  return rows;
}

/** Last-seen upsert — the presence beat (§4.11). A single row per user; the
 *  live "online now" half is the socket itself, not this table. */
async function touchPresence(client, userId) {
  const { rows } = await client.query(
    `INSERT INTO comms_user_presence (user_id, last_seen_at)
     VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()
     RETURNING *`,
    [userId],
  );
  return rows[0];
}

async function lastSeen(client, userIds) {
  if (!userIds.length) return [];
  const { rows } = await client.query(
    `SELECT user_id, last_seen_at FROM comms_user_presence
     WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows;
}

/* ── The record half (PR-2, migration 14010) ───────────────────────────────
 *
 * Recorded parts, transcripts, the browser live log and the summary draft. The
 * pipeline (smartcomm.call.pipeline.service.js) owns the order of these
 * writes; this file only reads and writes rows, same as everything above.
 */

/**
 * One recorded part, uploaded at hang-up (or retried after a dropped
 * connection — the client re-POSTs a part rather than losing the side).
 *
 * An UPSERT because a duplicate part is not a conflict to resolve, it is the
 * same part arriving twice: the row keeps its identity (and any transcription
 * already done on it) and takes the new bytes. A plain INSERT here would 23505
 * on the first flaky corridor connection and fail an upload that was fine.
 */
async function upsertRecordingPart(client, {
  callId, side, partIndex, partCount, vaultRef, mediaType, sizeBytes, durationSeconds,
}) {
  const { rows } = await client.query(
    `INSERT INTO comms_call_recording
       (call_id, side, part_index, part_count, vault_ref, media_type, size_bytes, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (call_id, side, part_index) DO UPDATE SET
       part_count       = EXCLUDED.part_count,
       vault_ref        = EXCLUDED.vault_ref,
       media_type       = EXCLUDED.media_type,
       size_bytes       = EXCLUDED.size_bytes,
       duration_seconds = EXCLUDED.duration_seconds,
       transcript_status = 'PENDING',
       error            = NULL
     RETURNING *`,
    [callId, side, partIndex, partCount, vaultRef, mediaType, sizeBytes, durationSeconds],
  );
  return rows[0];
}

/** Every part of a call, in transcript order (side, then part). */
async function listRecordingParts(client, callId) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call_recording
     WHERE call_id = $1
     ORDER BY side, part_index`,
    [callId],
  );
  return rows;
}

/** What one part's transcription attempt produced. `attempts` is incremented
 *  by the caller so a retry is visible on the row rather than only in logs. */
async function setPartResult(client, { recordingId, status, language = null, error = null, attempts }) {
  const { rows } = await client.query(
    `UPDATE comms_call_recording
     SET transcript_status = $2, detected_language = $3, error = $4, attempts = $5
     WHERE recording_id = $1
     RETURNING *`,
    [recordingId, status, language, error, attempts],
  );
  return rows[0] || null;
}

/** The retention sweep's read (D7): parts whose audio is past its window. */
async function partsAwaitingPurge(client, { olderThanDays }) {
  const { rows } = await client.query(
    `SELECT r.recording_id, r.vault_ref, r.call_id
     FROM comms_call_recording r
     WHERE r.purged_at IS NULL
       AND r.created_at <= now() - make_interval(days => $1::int)`,
    [olderThanDays],
  );
  return rows;
}

/** Retire the bytes. The row (and its transcript) stays forever — D7: the text
 *  is the record, the audio is the raw material. */
async function markPartsPurged(client, recordingIds) {
  if (!recordingIds.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE comms_call_recording SET purged_at = now()
     WHERE recording_id = ANY($1::uuid[]) AND purged_at IS NULL`,
    [recordingIds],
  );
  return rowCount;
}

/** The call-level state of the never-dies chain (§4.5). */
async function setTranscriptionState(client, { callId, state, error = null }) {
  const { rows } = await client.query(
    `UPDATE comms_call
     SET transcription_state = $2,
         transcription_error = $3,
         transcription_updated_at = now()
     WHERE call_id = $1
     RETURNING *`,
    [callId, state, error],
  );
  return rows[0] || null;
}

/** One more attempt against this call, counted where a sweep can see it (the
 *  auto-reprocess gives up eventually; a call that has failed 20 times is not
 *  coming back on the 21st). */
async function bumpTranscriptionAttempts(client, callId) {
  const { rows } = await client.query(
    `UPDATE comms_call
     SET transcription_attempts = transcription_attempts + 1
     WHERE call_id = $1
     RETURNING *`,
    [callId],
  );
  return rows[0] || null;
}

/** Calls the daily reprocess should try again: failed, and not abandoned. */
async function listFailedTranscriptions(client, { limit = 25, maxAttempts = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call
     WHERE transcription_state = 'TRANSCRIPTION_FAILED'
       AND transcription_attempts < $1
     ORDER BY transcription_updated_at ASC NULLS FIRST
     LIMIT $2`,
    [maxAttempts, limit],
  );
  return rows;
}

/**
 * Calls whose pipeline never finished: the ENDED row exists and the state is
 * NULL/PENDING, OR the state is PROCESSING and has gone stale.
 *
 * The second half matters more than it looks. PROCESSING is written before the
 * first vendor call and cleared by the last write of the run; a worker killed
 * mid-run (deploy, OOM, the SIGKILL the jest config documents) leaves it set
 * forever. Without this the caller's transcript would sit at "transcribing…"
 * until the end of time, which is precisely the silent stall §4.5 forbids —
 * and `processCall` will not re-enter a fresh PROCESSING row, so the retry has
 * to be found here rather than by luck.
 *
 * The bounds are the same ones `processCall` uses: 5 minutes of upload grace
 * after hang-up, 10 minutes before a PROCESSING row is presumed dead.
 */
async function listUntranscribedEndedCalls(client, { limit = 25 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call
     WHERE status IN ('ENDED','FAILED')
       AND ended_at IS NOT NULL
       AND (
         ((transcription_state IS NULL OR transcription_state = 'PENDING')
           AND ended_at <= now() - make_interval(mins => 5))
         OR (transcription_state = 'PROCESSING'
           AND (transcription_updated_at IS NULL
                OR transcription_updated_at <= now() - make_interval(mins => 10)))
       )
     ORDER BY ended_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Write a side's live capture segments (idempotent by seq).
 *
 * Chunked multi-row inserts: a 30-minute call is a few hundred segments, and
 * one statement per segment would be a few hundred round trips inside the
 * upload request. The ON CONFLICT is what makes a retried upload safe without
 * a transaction — the segment list is keyed on its own order.
 */
async function upsertLiveLog(client, { callId, side, segments }) {
  if (!segments.length) return 0;
  let written = 0;
  const CHUNK = 200;
  for (let i = 0; i < segments.length; i += CHUNK) {
    const slice = segments.slice(i, i + CHUNK);
    const values = [];
    const params = [callId, side];
    for (const s of slice) {
      const base = params.length;
      params.push(s.seq, s.text, s.language, s.startedMs ?? null, s.endedMs ?? null);
      values.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    }
    const { rowCount } = await client.query(
      `INSERT INTO comms_call_live_log
         (call_id, side, seq, text, language, started_ms, ended_ms)
       VALUES ${values.join(", ")}
       ON CONFLICT (call_id, side, seq) DO UPDATE SET
         text = EXCLUDED.text, language = EXCLUDED.language,
         started_ms = EXCLUDED.started_ms, ended_ms = EXCLUDED.ended_ms`,
      params,
    );
    written += rowCount;
  }
  return written;
}

async function listLiveLog(client, { callId, side = null }) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call_live_log
     WHERE call_id = $1 AND ($2::text IS NULL OR side = $2)
     ORDER BY side, seq`,
    [callId, side],
  );
  return rows;
}

/** Transcript rows for a side, in order — the CURRENT set only (a reprocessed
 *  side has its flagged rows retired rather than deleted, §4.5 step 3). */
async function listCurrentTranscripts(client, callId, side = null) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call_transcript
     WHERE call_id = $1 AND is_current AND ($2::text IS NULL OR side = $2)
     ORDER BY side, part_index`,
    [callId, side],
  );
  return rows;
}

/**
 * Insert a side's transcript rows (per side, per part).
 *
 * ATOMIC with the retire, and that pairing is the whole reason the unique index
 * on (call_id, side, part_index) WHERE is_current can exist:
 *
 *   - an upgrade (flagged → certified) writes the SAME keys, so inserting first
 *     would hit 23505 against the flagged row that is still current;
 *   - retiring first, on its own, would open a window — and worse, a crash
 *     inside it — in which the side has NO current rows at all. The
 *     transcript-never-dies rule (§4.5) does not survive a window like that.
 *
 * Both writes therefore run in one transaction: a reader sees the flagged text
 * or the certified text, never neither, and a failure anywhere leaves the
 * flagged rows exactly as the caller was told they were.
 */
async function insertTranscriptRows(client, { callId, side, rows: parts }) {
  if (!parts.length) return [];
  return atomically(client, async () => {
    // Only the rows being replaced — a part that is NOT in this set keeps
    // whatever it has (the pipeline retires the remainder explicitly after
    // this returns, so a changed part count cannot leave a mixture current).
    const replacing = parts.map((p) => p.partIndex);
    await client.query(
      `UPDATE comms_call_transcript
       SET is_current = false, superseded_at = now()
       WHERE call_id = $1 AND side = $2 AND part_index = ANY($3::int[])
         AND is_current AND provider = 'browser-live'`,
      [callId, side, replacing],
    );
    const values = [];
    const params = [callId, side];
    for (const p of parts) {
      const base = params.length;
      params.push(p.partIndex, p.text, p.language, p.provider, p.certified);
      values.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    }
    const { rows } = await client.query(
      `INSERT INTO comms_call_transcript
         (call_id, side, part_index, text, language, provider, certified)
       VALUES ${values.join(", ")}
       RETURNING *`,
      params,
    );
    return rows;
  });
}

/** Retire a side's flagged rows when the certified version lands. They stay in
 *  the table: what was said to the caller at the time is part of the record. */
async function retireFlaggedRows(client, { callId, side }) {
  const { rowCount } = await client.query(
    `UPDATE comms_call_transcript
     SET is_current = false, superseded_at = now()
     WHERE call_id = $1 AND side = $2 AND provider = 'browser-live' AND is_current`,
    [callId, side],
  );
  return rowCount;
}

/** Is the live capture still needed for this side (used to decide whether a
 *  reprocess can do better than what is already stored)? */
async function hasFlaggedRows(client, callId) {
  const { rows } = await client.query(
    `SELECT 1 AS ok FROM comms_call_transcript
     WHERE call_id = $1 AND provider = 'browser-live' AND is_current LIMIT 1`,
    [callId],
  );
  return rows.length > 0;
}

/* ── The summary draft ───────────────────────────────────────────────────── */

/**
 * Write the draft. An UPSERT on `call_id` (the table's own unique) because a
 * draft is regenerated in place — same row, new prose, and `created_at` stays
 * the moment the FIRST draft arrived, which is what the caller's screen shows.
 */
async function upsertSummaryDraft(client, {
  callId, summaryText, keyPoints, followUps, language, provenance,
}) {
  const { rows } = await client.query(
    `INSERT INTO comms_call_summary
       (call_id, summary_text, key_points, follow_ups, language, provenance)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
     ON CONFLICT (call_id) DO UPDATE SET
       summary_text = EXCLUDED.summary_text,
       key_points   = EXCLUDED.key_points,
       follow_ups   = EXCLUDED.follow_ups,
       language     = EXCLUDED.language,
       provenance   = EXCLUDED.provenance,
       draft_status = 'PENDING_REVIEW',
       update_available = false
     RETURNING *`,
    [callId, summaryText, JSON.stringify(keyPoints || []), JSON.stringify(followUps || []), language, provenance],
  );
  return rows[0];
}

/** The caller's app language, reported with the caller's own upload (§4.10).
 *  Only written when it CHANGES, so a 30-part upload is not 30 UPDATEs. */
async function setSummaryLanguage(client, { callId, language }) {
  const { rows } = await client.query(
    `UPDATE comms_call SET summary_language = $2
     WHERE call_id = $1 AND summary_language <> $2
     RETURNING *`,
    [callId, language],
  );
  return rows[0] || null;
}

/**
 * The caller's own edit of the draft, before it is sent.
 *
 * Deliberately NOT an upsert: this only ever touches a row that exists (the
 * pipeline created it), and it must not change `draft_status` — the edit is a
 * step inside the review, not a new draft.
 */
async function applySummaryEdit(client, { callId, summaryText, keyPoints, followUps }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET summary_text = $2, key_points = $3::jsonb, follow_ups = $4::jsonb
     WHERE call_id = $1
     RETURNING *`,
    [callId, summaryText, JSON.stringify(keyPoints || []), JSON.stringify(followUps || [])],
  );
  return rows[0] || null;
}

async function getSummary(client, callId) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call_summary WHERE call_id = $1`,
    [callId],
  );
  return rows[0] || null;
}

/** Record the posted message and flip the draft to SENT, in ONE statement:
 *  the row that says "sent" and the row that says "this message" cannot
 *  disagree, because there is no window between them. */
async function markSummarySent(client, { callId, messageId }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET draft_status = 'SENT', sent_message_id = $2, update_available = false
     WHERE call_id = $1
     RETURNING *`,
    [callId, messageId],
  );
  return rows[0] || null;
}

/** The optional update message (§4.5 step 3). Never rewrites `sent_message_id`:
 *  the first message stays exactly what the caller sent. */
async function markSummaryUpdateSent(client, { callId, messageId }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET update_message_id = $2, update_available = false
     WHERE call_id = $1
     RETURNING *`,
    [callId, messageId],
  );
  return rows[0] || null;
}

async function markUpdateAvailable(client, callId) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary SET update_available = true
     WHERE call_id = $1 AND draft_status = 'SENT'
     RETURNING *`,
    [callId],
  );
  return rows[0] || null;
}

async function markSummaryDiscarded(client, callId) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary SET draft_status = 'DISCARDED'
     WHERE call_id = $1 AND draft_status = 'PENDING_REVIEW'
     RETURNING *`,
    [callId],
  );
  return rows[0] || null;
}

/** One more EN/FR flip on the draft. Counted, because it is the one number
 *  that says whether the toggle is used or merely present. */
async function bumpRegenerateCount(client, { callId, language }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET regenerate_count = regenerate_count + 1, language = $2
     WHERE call_id = $1
     RETURNING *`,
    [callId, language],
  );
  return rows[0] || null;
}

module.exports = {
  ACTIVE_STATUSES,
  findActiveCall,
  insertCall,
  findCall,
  transition,
  otherParticipant,
  isParticipant,
  directPartner,
  listCallsForUser,
  touchPresence,
  lastSeen,
  // The ring half (PR-3, §4.6).
  markRingAck,
  markRingPushSent,
  // The record half (PR-2).
  upsertRecordingPart,
  listRecordingParts,
  setPartResult,
  partsAwaitingPurge,
  markPartsPurged,
  setTranscriptionState,
  bumpTranscriptionAttempts,
  listFailedTranscriptions,
  listUntranscribedEndedCalls,
  upsertLiveLog,
  listLiveLog,
  listCurrentTranscripts,
  insertTranscriptRows,
  retireFlaggedRows,
  hasFlaggedRows,
  setSummaryLanguage,
  upsertSummaryDraft,
  applySummaryEdit,
  getSummary,
  markSummarySent,
  markSummaryUpdateSent,
  markUpdateAvailable,
  markSummaryDiscarded,
  bumpRegenerateCount,
};
