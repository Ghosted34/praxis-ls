-- ============================================================================
-- TENANT — 14040 Smart Comms calls: move three closed vocabularies from CHECKs
-- into code (doc/SMART_COMMS_CALLS_AUDIT.md, PR-1 and owner decision A-1).
--
-- comms_call_transcript.provider and comms_call_summary.provenance gain
-- 'gemini' (the second transcription provider). An existing table may not gain
-- or widen a constraint (tests/unit/migration-constraint-ordering.test.js), so
-- the CHECKs are dropped and src/modules/smartcomm/smartcomm.call.vocab.js
-- holds the sets; the call repo refuses anything outside them. Names were read
-- from pg_constraint on a database built from 14000 + 14010.
-- ============================================================================

-- Was ('groq','browser-live'); now groq | gemini | browser-live.
ALTER TABLE comms_call_transcript DROP CONSTRAINT IF EXISTS comms_call_transcript_provider_check;
-- Was certified <=> provider = 'groq'; now certified <=> provider IN (groq, gemini).
ALTER TABLE comms_call_transcript DROP CONSTRAINT IF EXISTS ck_comms_call_transcript_certified;
-- Was ('groq','browser-live','transcript-only'); now also 'gemini'.
ALTER TABLE comms_call_summary DROP CONSTRAINT IF EXISTS comms_call_summary_provenance_check;

-- DOWN
-- Re-adding a CHECK fails while any row holds a 'gemini' value; this DOWN is
-- only valid on a tenant that has never used the Gemini fallback.
-- ALTER TABLE comms_call_summary ADD CONSTRAINT comms_call_summary_provenance_check
--   CHECK (provenance IN ('groq','browser-live','transcript-only'));
-- ALTER TABLE comms_call_transcript ADD CONSTRAINT ck_comms_call_transcript_certified
--   CHECK ((certified AND provider = 'groq') OR (NOT certified AND provider = 'browser-live'));
-- ALTER TABLE comms_call_transcript ADD CONSTRAINT comms_call_transcript_provider_check
--   CHECK (provider IN ('groq','browser-live'));
