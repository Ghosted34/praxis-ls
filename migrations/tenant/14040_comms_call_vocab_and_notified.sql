-- ============================================================================
-- TENANT — 14040 Smart Comms calls (doc/SMART_COMMS_CALLS_AUDIT.md, PR-1).
--
-- 1. Three closed vocabularies move from CHECKs into code. An existing table
--    may not gain or widen a constraint
--    (tests/unit/migration-constraint-ordering.test.js), so the CHECKs are
--    dropped and src/modules/smartcomm/smartcomm.call.vocab.js holds the sets;
--    the call repo refuses anything outside them. Constraint names were read
--    from pg_constraint on a database built from 14000 + 14010.
-- 2. comms_call_summary.notified_at: when the one "summary ready" push was
--    sent (audit A4). Claimed atomically; a sweep run never claims it.
-- 3. transcription_state gains 'NO_RECORDING' (audit A5). The column has no
--    CHECK (14010), so that part is data only.
-- ============================================================================

-- B1: the liveness sweep ends calls 'disconnected', which the CHECK refused
-- (23514), so the sweep crashed every 15 s and the call stayed open.
ALTER TABLE comms_call DROP CONSTRAINT IF EXISTS comms_call_end_reason_check;

-- Was ('groq','browser-live'); now groq | gemini | browser-live.
ALTER TABLE comms_call_transcript DROP CONSTRAINT IF EXISTS comms_call_transcript_provider_check;
-- Was certified <=> provider = 'groq'; now certified <=> provider IN (groq, gemini).
ALTER TABLE comms_call_transcript DROP CONSTRAINT IF EXISTS ck_comms_call_transcript_certified;
-- Was ('groq','browser-live','transcript-only'); now also 'gemini'.
ALTER TABLE comms_call_summary DROP CONSTRAINT IF EXISTS comms_call_summary_provenance_check;

ALTER TABLE comms_call_summary ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Calls that ended more than a day ago, never ran the pipeline, and have no
-- recording: nothing will ever be transcribed, so stop the sweep choosing them.
-- (A live-capture log alone no longer counts: owner decision A-1.)
UPDATE comms_call c
   SET transcription_state = 'NO_RECORDING',
       transcription_updated_at = now()
 WHERE c.status IN ('ENDED','FAILED')
   AND c.transcription_state IS NULL
   AND c.ended_at < now() - interval '1 day'
   AND NOT EXISTS (SELECT 1 FROM comms_call_recording r WHERE r.call_id = c.call_id);

-- DOWN
-- UPDATE comms_call SET transcription_state = NULL WHERE transcription_state = 'NO_RECORDING';
-- ALTER TABLE comms_call_summary DROP COLUMN IF EXISTS notified_at;
-- Re-adding a CHECK fails while any row holds a value outside the old set
-- ('disconnected', 'gemini'); these lines are only valid on a tenant that has
-- used neither.
-- ALTER TABLE comms_call ADD CONSTRAINT comms_call_end_reason_check
--   CHECK (end_reason IS NULL OR end_reason IN ('hangup','declined','cancelled','no_answer','busy','max_duration','ice_failed'));
-- ALTER TABLE comms_call_summary ADD CONSTRAINT comms_call_summary_provenance_check
--   CHECK (provenance IN ('groq','browser-live','transcript-only'));
-- ALTER TABLE comms_call_transcript ADD CONSTRAINT ck_comms_call_transcript_certified
--   CHECK ((certified AND provider = 'groq') OR (NOT certified AND provider = 'browser-live'));
-- ALTER TABLE comms_call_transcript ADD CONSTRAINT comms_call_transcript_provider_check
--   CHECK (provider IN ('groq','browser-live'));
