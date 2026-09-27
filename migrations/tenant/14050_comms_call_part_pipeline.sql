-- ============================================================================
-- TENANT — 14050 Smart Comms calls: per-part transcription and the "side
-- complete" declaration (doc/SMART_COMMS_CALLS_AUDIT.md, PR-2).
--
-- 1. comms_call gains the declared part count of each side and when it was
--    declared (A2). The finalise job certifies only when every declared part
--    has a result. `finalised_at` is when the draft was last built, so a
--    re-run with nothing new calls no provider.
-- 2. comms_call_recording gains the per-part result's bookkeeping: which
--    provider answered, when the job claimed and settled the part, and how
--    many automatic and manual runs it has had (capped in code).
-- 3. Two 14010 CHECKs are dropped and their sets move into
--    src/modules/smartcomm/smartcomm.call.vocab.js, as 14040 did for three
--    others. An existing table may not gain or widen a constraint
--    (tests/unit/migration-constraint-ordering.test.js):
--      - draft_status must accept 'SENDING' (B7: the send claims the draft);
--      - duration_seconds must accept up to 125 s (B11: a part cut by a
--        throttled tab runs slightly past 120 s).
--    Names read from pg_constraint on a tenant provisioned from nothing.
--    14010's comment on sent_message_id says no code path posts without that
--    write in the same transaction. That was not true until now: the send
--    claims the draft (SENDING), writes the message and marks it SENT in one
--    transaction (smartcomm.call.pipeline.service.js sendSummary).
-- 4. Parts of calls recorded before this migration whose transcription never
--    ran are parts 2..N of one continuous MediaRecorder stream (A3): no
--    container header, so no provider can decode them. They are closed as
--    FAILED rather than billed to Groq by the part sweep.
-- ============================================================================

ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS caller_parts_declared int;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS callee_parts_declared int;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS caller_completed_at timestamptz;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS callee_completed_at timestamptz;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS finalised_at timestamptz;

-- groq | gemini, the provider that produced the part's transcript (vocab.js).
ALTER TABLE comms_call_recording ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE comms_call_recording ADD COLUMN IF NOT EXISTS transcribe_started_at timestamptz;
ALTER TABLE comms_call_recording ADD COLUMN IF NOT EXISTS transcribed_at timestamptz;
ALTER TABLE comms_call_recording ADD COLUMN IF NOT EXISTS job_runs int NOT NULL DEFAULT 0;
ALTER TABLE comms_call_recording ADD COLUMN IF NOT EXISTS manual_runs int NOT NULL DEFAULT 0;

-- Was ('PENDING_REVIEW','SENT','DISCARDED'); now also 'SENDING'.
ALTER TABLE comms_call_summary DROP CONSTRAINT IF EXISTS comms_call_summary_draft_status_check;
-- Was 0..120; now 0..125.
ALTER TABLE comms_call_recording DROP CONSTRAINT IF EXISTS comms_call_recording_duration_seconds_check;

-- The part sweep's read: parts that are still waiting for a result.
CREATE INDEX IF NOT EXISTS ix_comms_call_recording_pending
  ON comms_call_recording (created_at) WHERE transcript_status = 'PENDING';

-- The old recorder never declared a side, so an ended call with no
-- declaration on either side is one of its calls; a re-run of this file
-- cannot reach a call recorded by the new one once it has declared.
UPDATE comms_call_recording r
   SET transcript_status = 'FAILED',
       error = 'recorded before per-part recording: not a complete audio file',
       transcribed_at = now()
  FROM comms_call c
 WHERE c.call_id = r.call_id
   AND c.ended_at IS NOT NULL
   AND c.caller_parts_declared IS NULL
   AND c.callee_parts_declared IS NULL
   AND r.transcript_status = 'PENDING'
   AND r.part_index >= 2
   AND r.transcribe_started_at IS NULL
   AND r.job_runs = 0;

-- DOWN
-- UPDATE comms_call_recording SET transcript_status = 'PENDING', error = NULL, transcribed_at = NULL
--  WHERE error = 'recorded before per-part recording: not a complete audio file';
-- DROP INDEX IF EXISTS ix_comms_call_recording_pending;
-- ALTER TABLE comms_call_recording DROP COLUMN IF EXISTS manual_runs;
-- ALTER TABLE comms_call_recording DROP COLUMN IF EXISTS job_runs;
-- ALTER TABLE comms_call_recording DROP COLUMN IF EXISTS transcribed_at;
-- ALTER TABLE comms_call_recording DROP COLUMN IF EXISTS transcribe_started_at;
-- ALTER TABLE comms_call_recording DROP COLUMN IF EXISTS provider;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS finalised_at;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS callee_completed_at;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS caller_completed_at;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS callee_parts_declared;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS caller_parts_declared;
-- Re-adding a CHECK fails while any row holds a value outside the old set
-- ('SENDING', a 121-125 s part); these lines are only valid on a tenant that
-- has neither.
-- ALTER TABLE comms_call_summary ADD CONSTRAINT comms_call_summary_draft_status_check
--   CHECK (draft_status IN ('PENDING_REVIEW','SENT','DISCARDED'));
-- ALTER TABLE comms_call_recording ADD CONSTRAINT comms_call_recording_duration_seconds_check
--   CHECK (duration_seconds >= 0 AND duration_seconds <= 120);
