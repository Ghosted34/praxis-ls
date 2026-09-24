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
const vocab = require("./smartcomm.call.vocab");

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
async function insertCall(client, { groupId, callerId, calleeId, turnToken = null }) {
  try {
    const { rows } = await client.query(
      `INSERT INTO comms_call (group_id, caller_id, callee_id, status, turn_token)
       VALUES ($1, $2, $3, 'RINGING', $4)
       RETURNING *`,
      [groupId, callerId, calleeId, turnToken],
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
 *  Returns the updated row, or null when someone got there first. The
 *  end-reason set is enforced here since 14040 dropped its CHECK (audit B1). */
async function transition(client, { callId, fromStatus, status, fields = {} }) {
  if (fields.end_reason !== undefined && fields.end_reason !== null
      && !vocab.END_REASONS.includes(fields.end_reason)) {
    throw new Error(`invalid call end reason: ${fields.end_reason}`);
  }
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

/** The other participant of a LIVE call (RINGING or IN_CALL), relative to
 *  `userId`; null for a stranger or a call that has ended (audit C5). */
async function liveCounterpart(client, { callId, userId }) {
  const { rows } = await client.query(
    `SELECT CASE WHEN caller_id = $2 THEN callee_id ELSE caller_id END AS user_id
     FROM comms_call
     WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)
       AND status IN ('RINGING','IN_CALL')`,
    [callId, userId],
  );
  return rows[0] || null;
}

/** The call's relay-credential token (audit C2). A call gets it at insert;
 *  this backfills a call dialled before migration 14060, and only while it is
 *  RINGING or IN_CALL. Null otherwise. */
async function ensureTurnToken(client, { callId, token }) {
  const { rows } = await client.query(
    `UPDATE comms_call SET turn_token = COALESCE(turn_token, $2)
     WHERE call_id = $1 AND status IN ('RINGING','IN_CALL')
     RETURNING turn_token`,
    [callId, token],
  );
  return rows[0] ? rows[0].turn_token : null;
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

/** The other member of a DIRECT channel, if their account is ACTIVE (audit
 *  C6: a deactivated employee's phone is never rung). Null for a group
 *  channel, and for a direct channel whose other member is not active.
 *
 *  The status is read from `live.app_user` in both environments: identity is
 *  pinned to live, and `sandbox.app_user` is a mirror whose status is never
 *  updated after the row is copied (shared/db/sandbox-user-mirror.js). */
async function directPartner(client, { groupId, userId }) {
  const { rows } = await client.query(
    `SELECT m.user_id
     FROM comms_group g
     JOIN comms_member m ON m.group_id = g.group_id
     JOIN live.app_user u ON u.user_id = m.user_id AND u.status = 'ACTIVE'
     WHERE g.group_id = $1 AND g.kind = 'DIRECT' AND m.user_id <> $2
     LIMIT 1`,
    [groupId, userId],
  );
  return rows[0] || null;
}

async function isDirectChannel(client, groupId) {
  const { rows } = await client.query(
    "SELECT 1 AS ok FROM comms_group WHERE group_id = $1 AND kind = 'DIRECT'",
    [groupId],
  );
  return rows.length > 0;
}

/** The user's calls, newest first, with what the Calls list badges: the
 *  transcription state (on the row) and the summary's status. */
async function listCallsForUser(client, userId, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT c.*, g.name AS channel_name,
            cu.full_name AS caller_name,
            bu.full_name AS callee_name,
            s.draft_status, s.notified_at, s.update_available AS summary_update_available
     FROM comms_call c
     JOIN comms_group g ON g.group_id = c.group_id
     JOIN app_user cu ON cu.user_id = c.caller_id
     JOIN app_user bu ON bu.user_id = c.callee_id
     LEFT JOIN comms_call_summary s ON s.call_id = c.call_id
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

/* ── The record half (migrations 14010, 14040, 14050) ──────────────────────
 *
 * Recorded parts, their per-part results, transcripts, the retired browser
 * live log and the summary draft. The pipeline
 * (smartcomm.call.pipeline.service.js) owns the order of these writes.
 */

/**
 * One recorded part. Re-uploading a part that is still PENDING replaces its
 * bytes in place (a retry after a lost acknowledgement); a part that already
 * has a result is never overwritten, and null is returned so the caller
 * leaves storage alone and never re-sends it to a provider.
 */
async function upsertRecordingPart(client, {
  callId, side, partIndex, partCount, vaultRef, mediaType, sizeBytes, durationSeconds,
}) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > vocab.PART_MAX_SECONDS) {
    throw new Error(`invalid part duration: ${durationSeconds}`);
  }
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
       error            = NULL
     WHERE comms_call_recording.transcript_status = 'PENDING'
     RETURNING *`,
    [callId, side, partIndex, partCount, vaultRef, mediaType, sizeBytes, durationSeconds],
  );
  return rows[0] || null;
}

async function findRecordingPart(client, { callId, side, partIndex }) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call_recording
     WHERE call_id = $1 AND side = $2 AND part_index = $3`,
    [callId, side, partIndex],
  );
  return rows[0] || null;
}

/** Bytes a side has stored, not counting one part (the one being replaced). */
async function sideUploadedBytes(client, { callId, side, exceptPartIndex = null }) {
  const { rows } = await client.query(
    `SELECT coalesce(sum(size_bytes), 0)::bigint AS bytes, coalesce(max(part_index), 0) AS max_part
     FROM comms_call_recording
     WHERE call_id = $1 AND side = $2 AND ($3::int IS NULL OR part_index <> $3)`,
    [callId, side, exceptPartIndex],
  );
  return { bytes: Number(rows[0].bytes), maxPart: Number(rows[0].max_part) };
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

const SIDE_COLUMNS = {
  caller: { declared: "caller_parts_declared", at: "caller_completed_at" },
  callee: { declared: "callee_parts_declared", at: "callee_completed_at" },
};

/**
 * A side says it has finished recording and how many parts it made (audit
 * A2). Idempotent for the same count; a different count on a side that has
 * already declared matches nothing, so the first declaration stands.
 */
async function declareSide(client, { callId, side, parts }) {
  const col = SIDE_COLUMNS[side];
  if (!col) throw new Error(`invalid call side: ${side}`);
  const { rows } = await client.query(
    `UPDATE comms_call
     SET ${col.declared} = $2, ${col.at} = coalesce(${col.at}, now())
     WHERE call_id = $1 AND (${col.declared} IS NULL OR ${col.declared} = $2)
     RETURNING *`,
    [callId, parts],
  );
  return rows[0] || null;
}

/**
 * Claim a PENDING part for one transcription run. Exactly one job wins a
 * part; a part claimed less than `staleMinutes` ago belongs to a live job, and
 * a part that has had `maxRuns` automatic runs is not claimed again.
 */
async function claimPart(client, { recordingId, staleMinutes, maxRuns }) {
  const { rows } = await client.query(
    `UPDATE comms_call_recording
     SET transcribe_started_at = now(), job_runs = job_runs + 1
     WHERE recording_id = $1
       AND transcript_status = 'PENDING'
       AND purged_at IS NULL
       AND job_runs < $3
       AND (transcribe_started_at IS NULL
            OR transcribe_started_at <= now() - make_interval(mins => $2::int))
     RETURNING *`,
    [recordingId, staleMinutes, maxRuns],
  );
  return rows[0] || null;
}

/**
 * An admin's manual re-run of a part that failed on both providers (owner
 * decision O1: never automatic). The part goes back to PENDING with a fresh
 * automatic-run budget; `manual_runs` bounds how often a person can do this.
 */
async function reopenFailedPart(client, { recordingId, maxManual }) {
  const { rows } = await client.query(
    `UPDATE comms_call_recording
     SET transcript_status = 'PENDING', error = NULL, transcribe_started_at = NULL,
         transcribed_at = NULL, job_runs = 0, manual_runs = manual_runs + 1
     WHERE recording_id = $1
       AND transcript_status = 'FAILED'
       AND purged_at IS NULL
       AND manual_runs < $2
     RETURNING *`,
    [recordingId, maxManual],
  );
  return rows[0] || null;
}

/** What one part's run produced. Only a PENDING part takes a result, so a
 *  settled part is never overwritten by a late duplicate. */
async function setPartResult(client, {
  recordingId, status, language = null, error = null, attempts, provider = null,
}) {
  const { rows } = await client.query(
    `UPDATE comms_call_recording
     SET transcript_status = $2, detected_language = $3, error = $4, attempts = $5,
         provider = $6, transcribed_at = now()
     WHERE recording_id = $1 AND transcript_status = 'PENDING'
     RETURNING *`,
    [recordingId, status, language, error, attempts, provider],
  );
  return rows[0] || null;
}

/**
 * Parts whose job never ran, or died mid-run, and still have automatic runs
 * left: the only automatic re-run there is. A part never claimed counts once
 * it has waited `queuedMinutes` (the job may simply be queued); a claimed one
 * once its claim is `staleMinutes` old.
 */
async function listStalledParts(client, {
  staleMinutes, maxRuns, queuedMinutes = staleMinutes, callId = null, limit = 50,
}) {
  const { rows } = await client.query(
    `SELECT r.recording_id, r.call_id, r.side, r.part_index
     FROM comms_call_recording r
     WHERE r.transcript_status = 'PENDING'
       AND r.purged_at IS NULL
       AND r.job_runs < $2
       AND ($5::uuid IS NULL OR r.call_id = $5)
       AND (
         (r.transcribe_started_at IS NULL AND r.created_at <= now() - make_interval(mins => $3::int))
         OR r.transcribe_started_at <= now() - make_interval(mins => $1::int)
       )
     ORDER BY r.created_at ASC
     LIMIT $4`,
    [staleMinutes, maxRuns, queuedMinutes, limit, callId],
  );
  return rows;
}

/** Parts that used every automatic run and still have no result are closed,
 *  so finalise can name them as missing instead of waiting on them. */
async function closeExhaustedParts(client, { staleMinutes, maxRuns, callId = null }) {
  const { rows } = await client.query(
    `UPDATE comms_call_recording
     SET transcript_status = 'FAILED', error = 'the transcription job did not complete',
         transcribed_at = now()
     WHERE transcript_status = 'PENDING'
       AND purged_at IS NULL
       AND job_runs >= $2
       AND ($3::uuid IS NULL OR call_id = $3)
       AND coalesce(transcribe_started_at, created_at) <= now() - make_interval(mins => $1::int)
     RETURNING recording_id, call_id`,
    [staleMinutes, maxRuns, callId],
  );
  return rows;
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

/** The call-level state (PENDING, PROCESSING, CERTIFIED, TRANSCRIPTION_FAILED,
 *  NO_RECORDING). No CHECK on the column (14010); this is the only writer. */
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

/** One more finalise run against this call; the call sweep stops at a cap. */
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

async function markFinalised(client, callId) {
  const { rows } = await client.query(
    `UPDATE comms_call SET finalised_at = now() WHERE call_id = $1 RETURNING *`,
    [callId],
  );
  return rows[0] || null;
}

/**
 * Calls whose finalise never ran, or died mid-run, past the hang-up deadline
 * (ended_at + 10 min, plus a margin). Capped on every branch, stale
 * PROCESSING included (audit B4). A FAILED call that never connected has no
 * audio and is excluded (B5). TRANSCRIPTION_FAILED is not selected: a part
 * that failed on both providers is never retried automatically (O1).
 */
async function listUnfinalisedCalls(client, { limit = 25, maxAttempts, afterMinutes = 15, staleMinutes = 10 }) {
  const { rows } = await client.query(
    `SELECT * FROM comms_call
     WHERE status IN ('ENDED','FAILED')
       AND (status = 'ENDED' OR connected_at IS NOT NULL)
       AND ended_at IS NOT NULL
       AND ended_at <= now() - make_interval(mins => $2::int)
       AND transcription_attempts < $1
       AND (
         transcription_state IS NULL OR transcription_state = 'PENDING'
         OR (transcription_state = 'PROCESSING'
           AND (transcription_updated_at IS NULL
                OR transcription_updated_at <= now() - make_interval(mins => $3::int)))
       )
     ORDER BY ended_at ASC
     LIMIT $4`,
    [maxAttempts, afterMinutes, staleMinutes, limit],
  );
  return rows;
}


/** Transcript rows for a side, in order — the CURRENT set only. */
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
 * Insert transcript rows for a side, retiring whatever row is current for
 * each part being written, whatever its provider (audit B4: re-inserting a
 * certified part used to hit uq_comms_call_transcript_current with 23505).
 * One transaction, so a reader sees the old row or the new one, never neither.
 */
async function insertTranscriptRows(client, { callId, side, rows: parts }) {
  if (!parts.length) return [];
  // The CHECKs 14040 dropped, held here instead.
  const bad = parts.find((p) => !vocab.isValidTranscriptRow(p));
  if (bad) {
    throw new Error(`invalid transcript row: provider=${bad.provider} certified=${bad.certified}`);
  }
  return atomically(client, async () => {
    await client.query(
      `UPDATE comms_call_transcript
       SET is_current = false, superseded_at = now()
       WHERE call_id = $1 AND side = $2 AND part_index = ANY($3::int[]) AND is_current`,
      [callId, side, parts.map((p) => p.partIndex)],
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

/* ── The summary draft ───────────────────────────────────────────────────── */

/**
 * Write the draft, but only over a draft that is still PENDING_REVIEW (audit
 * B6). The status is checked by the upsert itself, on the row as it is at that
 * moment, so a summary sent or discarded while the pipeline was working is
 * never revived. Returns null when the existing row was not a pending draft.
 */
async function upsertSummaryDraft(client, {
  callId, summaryText, keyPoints, followUps, language, provenance,
}) {
  if (!vocab.SUMMARY_PROVENANCES.includes(provenance)) {
    throw new Error(`invalid summary provenance: ${provenance}`);
  }
  const { rows } = await client.query(
    `INSERT INTO comms_call_summary
       (call_id, summary_text, key_points, follow_ups, language, provenance)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
     ON CONFLICT (call_id) DO UPDATE SET
       summary_text = EXCLUDED.summary_text,
       key_points   = EXCLUDED.key_points,
       follow_ups   = EXCLUDED.follow_ups,
       language     = EXCLUDED.language,
       provenance   = EXCLUDED.provenance
     WHERE comms_call_summary.draft_status = 'PENDING_REVIEW'
     RETURNING *`,
    [callId, summaryText, JSON.stringify(keyPoints || []), JSON.stringify(followUps || []), language, provenance],
  );
  return rows[0] || null;
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
 * Claim a pending draft for sending, with the caller's final edit (audit
 * B7). Runs inside the send transaction: a second send blocks on the row lock
 * and then matches nothing, because the first has moved it on.
 */
async function claimDraftForSend(client, { callId, summaryText, keyPoints, followUps }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET draft_status = 'SENDING', summary_text = $2, key_points = $3::jsonb, follow_ups = $4::jsonb
     WHERE call_id = $1 AND draft_status = 'PENDING_REVIEW'
     RETURNING *`,
    [callId, summaryText, JSON.stringify(keyPoints || []), JSON.stringify(followUps || [])],
  );
  return rows[0] || null;
}

/** The same claim for the optional update of a summary already sent. */
async function claimUpdateForSend(client, { callId, summaryText, keyPoints, followUps }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET update_available = false, summary_text = $2, key_points = $3::jsonb, follow_ups = $4::jsonb
     WHERE call_id = $1 AND draft_status = 'SENT' AND update_available
     RETURNING *`,
    [callId, summaryText, JSON.stringify(keyPoints || []), JSON.stringify(followUps || [])],
  );
  return rows[0] || null;
}

/** Claim the one "summary ready" notification for a call (audit A4). Exactly
 *  one caller gets the row back; everyone after that gets null. */
async function claimSummaryNotification(client, callId) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary SET notified_at = now()
     WHERE call_id = $1 AND notified_at IS NULL
     RETURNING *`,
    [callId],
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

/** The claimed draft becomes SENT with the message it was posted as. */
async function markSummarySent(client, { callId, messageId }) {
  const { rows } = await client.query(
    `UPDATE comms_call_summary
     SET draft_status = 'SENT', sent_message_id = $2, update_available = false
     WHERE call_id = $1 AND draft_status = 'SENDING'
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

/**
 * The caller's drafts waiting in one conversation (owner decision O3): the
 * card pinned above the composer. Only while recording is on, because the
 * editor's routes are behind that flag.
 */
async function pendingDraftsInChannel(client, { groupId, userId, limit = 5 }) {
  const { rows } = await client.query(
    `SELECT s.call_id, s.created_at AS drafted_at, s.provenance, s.language,
            c.started_at, c.ended_at, c.duration_seconds, c.transcription_state
     FROM comms_call_summary s
     JOIN comms_call c ON c.call_id = s.call_id
     WHERE c.group_id = $1 AND c.caller_id = $2 AND s.draft_status = 'PENDING_REVIEW'
       AND EXISTS (SELECT 1 FROM feature_state f
                   WHERE f.feature_key = 'call_recording' AND f.state = 'on')
     ORDER BY c.started_at DESC
     LIMIT $3`,
    [groupId, userId, limit],
  );
  return rows;
}

module.exports = {
  ensureTurnToken,
  ACTIVE_STATUSES,
  findActiveCall,
  insertCall,
  findCall,
  transition,
  liveCounterpart,
  isParticipant,
  directPartner,
  isDirectChannel,
  listCallsForUser,
  touchPresence,
  lastSeen,
  // The ring half (PR-3, §4.6).
  markRingAck,
  markRingPushSent,
  // The record half.
  upsertRecordingPart,
  findRecordingPart,
  sideUploadedBytes,
  listRecordingParts,
  declareSide,
  claimPart,
  reopenFailedPart,
  setPartResult,
  listStalledParts,
  closeExhaustedParts,
  partsAwaitingPurge,
  markPartsPurged,
  setTranscriptionState,
  bumpTranscriptionAttempts,
  markFinalised,
  listUnfinalisedCalls,
  listCurrentTranscripts,
  insertTranscriptRows,
  setSummaryLanguage,
  upsertSummaryDraft,
  claimDraftForSend,
  claimUpdateForSend,
  getSummary,
  claimSummaryNotification,
  markSummarySent,
  markSummaryUpdateSent,
  markUpdateAvailable,
  markSummaryDiscarded,
  bumpRegenerateCount,
  pendingDraftsInChannel,
};
