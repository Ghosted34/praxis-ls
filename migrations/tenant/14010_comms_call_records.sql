-- ============================================================================
-- TENANT — 14010 Smart Comms calls, the record half: recorded audio PARTS,
-- per-part attributed transcripts (certified vs flagged), the browser live
-- capture log, and the summary draft (doc/SMART_COMMS_CALLS_ENGINEERING_GUIDE.md
-- §4.2 / §4.5 / §4.9 / §4.10, PR-2).
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
--   comms_call_recording   one row per Side × part. A call is recorded as
--                          60–120 s parts (§4.5) — not one blob — because the
--                          transcription vendor takes a file, and a 27-minute
--                          call is 15–30 uploads per side that can retry
--                          individually. A part's DETECTED LANGUAGE lives here
--                          (row 7: no forced language for calls).
--
--   comms_call_transcript  one row per Side × part: the words. `certified` is
--                          the whole point of the table: TRUE only for text a
--                          provider produced from the vaulted bytes (D5),
--                          FALSE for the browser live capture that carries a
--                          call when the provider is down (§4.5 step 3).
--                          Certification is an INVARIANT, not a convention —
--                          see the CHECK on the pair below.
--
--   comms_call_live_log    §4.9: what each side's browser recogniser heard,
--                          segment by segment, captured during the call and
--                          uploaded at hang-up. It is never shown as a
--                          transcript anywhere: it is the fallback's raw
--                          material, and the raw material for nothing else.
--
--   comms_call_summary     the draft the CALLER reviews (decision row 3) and
--                          sends with one tap. key_points/follow_ups stay
--                          verbatim in the language spoken (§4.10); the
--                          connective prose is drafted in the caller's app
--                          language, stored as `language`.
--
--   comms_attachment.call_id  how the posted card hangs off the message: the
--                          summary card is a normal caller message with a CALL
--                          attachment, resolved like an erp-card at read time.
--
--   comms_call.transcription_*  the call-level state of the never-dies chain
--                          (§4.5): PENDING → PROCESSING → CERTIFIED, or
--                          TRANSCRIPTION_FAILED — retryable, visible, and
--                          alerted. There is no fourth outcome; a call with no
--                          words anywhere is TRANSCRIPTION_FAILED, said out
--                          loud, and the daily reprocess comes back for it.
--
-- ── WHY `is_current` AND NOT DELETE ────────────────────────────────────────
--
-- Reprocessing (§4.5 step 3) REPLACES a flagged transcript with the certified
-- one. The flagged rows stay: they are what was said to the caller at the
-- time, and deleting them would make the record of a fallback event
-- retroactively vanish. So the reader filters `is_current`, the upgrade
-- retires the old rows, and the audit trail of "this was recovered" survives
-- inside the same table. A unique index keeps exactly one current row per
-- Side × part, so two racing reprocesses cannot both win.
--
-- ── WHY THE FEATURE FLAG HAS A SECOND KEY ──────────────────────────────────
--
-- Decision row 2 asks for a TENANT-LEVEL kill switch on recording. The PR-1
-- `calls` key kills calls, which is a different decision: a tenant can
-- reasonably want internal calls without their audio and words being retained
-- at all. `call_recording` (default ON, depends_on {calls}) is that switch.
-- Off, the client starts no recorder and shows no consent banner — because
-- there is nothing to consent to — and the recording/transcript routes answer
-- 403 like every other gated feature. The platform half of the flag is seed
-- 9135 (both halves, or the flag is a feature nobody can turn on).
--
-- ── IDEMPOTENCY ────────────────────────────────────────────────────────────
--
-- Everything is IF NOT EXISTS / OR REPLACE, the one constraint addition is
-- inside a catalog-guarded DO block (no ADD CONSTRAINT IF NOT EXISTS exists in
-- Postgres), and every INSERT carries exactly one ON CONFLICT.
-- ============================================================================

-- ── Recorded audio, in parts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comms_call_recording (
  recording_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id           uuid NOT NULL REFERENCES comms_call(call_id) ON DELETE CASCADE,
  -- 'caller' | 'callee' — the two sides are recorded separately and never
  -- mixed (decision row 4: attributed, not blended).
  side              text NOT NULL CHECK (side IN ('caller','callee')),
  -- 1-based. The order IS the transcript order, and the language boundary of
  -- a code-switched call is a part boundary (row 7).
  part_index        int NOT NULL CHECK (part_index >= 1),
  -- What the client said the side would be worth, so a side that uploaded
  -- 12 of its declared 14 parts is visibly incomplete rather than silently so.
  part_count        int NOT NULL CHECK (part_count >= 1 AND part_count <= 60),
  -- The object-storage key of this part's bytes (services/storage.service —
  -- the same driver the voice notes use). D7: audio is the raw material and
  -- is retained 30 days, then swept; the text is the record.
  vault_ref         text NOT NULL,
  media_type        text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes >= 0),
  duration_seconds  int NOT NULL CHECK (duration_seconds >= 0 AND duration_seconds <= 120),
  -- The language the PROVIDER detected for this part (no hint is sent for
  -- calls, so this is the vendor's own answer). NULL until it is transcribed.
  detected_language text CHECK (detected_language IS NULL OR detected_language IN ('en','fr')),
  transcript_status text NOT NULL DEFAULT 'PENDING'
    CHECK (transcript_status IN ('PENDING','OK','FAILED')),
  -- Per-part retry bookkeeping: 3 attempts, then this part fails and the
  -- WHOLE side falls back (§4.5 step 2 — a transcript with one hole is worse
  -- than a complete flagged one).
  attempts          int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error             text,
  -- Set by the D7 retention sweep once the bytes are gone; the row and its
  -- transcript stay forever.
  purged_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One row per part. A retried upload REPLACES its part (the client can
  -- re-upload after a dropped connection) rather than duplicating it — see
  -- the upsert in smartcomm.call.repo.js.
  CONSTRAINT uq_comms_call_recording_part UNIQUE (call_id, side, part_index)
);

CREATE INDEX IF NOT EXISTS ix_comms_call_recording_call
  ON comms_call_recording (call_id, side, part_index);
-- The retention sweep's read: parts whose audio is due for deletion.
CREATE INDEX IF NOT EXISTS ix_comms_call_recording_retain
  ON comms_call_recording (created_at) WHERE purged_at IS NULL;

-- ── Attributed transcripts, per Side × part ────────────────────────────────
CREATE TABLE IF NOT EXISTS comms_call_transcript (
  transcript_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id       uuid NOT NULL REFERENCES comms_call(call_id) ON DELETE CASCADE,
  side          text NOT NULL CHECK (side IN ('caller','callee')),
  part_index    int NOT NULL CHECK (part_index >= 1),
  -- The words. An empty string is legal and means "silence in this part" —
  -- that is a real outcome of a real call, and it is not the same as missing.
  text          text NOT NULL,
  language      text NOT NULL CHECK (language IN ('en','fr')),
  provider      text NOT NULL CHECK (provider IN ('groq','browser-live')),
  -- D5, as a constraint rather than a promise: certified text is ALWAYS
  -- provider-produced from the vaulted bytes, and browser text is NEVER
  -- certified into the record.
  certified     boolean NOT NULL,
  -- Reprocess upgrade (§4.5 step 3): the flagged rows are retired, not
  -- deleted — see the header.
  is_current    boolean NOT NULL DEFAULT true,
  superseded_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_comms_call_transcript_certified
    CHECK ((certified AND provider = 'groq') OR (NOT certified AND provider = 'browser-live')),
  CONSTRAINT ck_comms_call_transcript_supersede
    CHECK ((is_current AND superseded_at IS NULL) OR (NOT is_current AND superseded_at IS NOT NULL))
);

-- Exactly one CURRENT row per Side × part: the two forms of the same words
-- (flagged, then recovered) can coexist, never two of either.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comms_call_transcript_current
  ON comms_call_transcript (call_id, side, part_index) WHERE is_current;

-- ── The browser live capture (§4.9) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comms_call_live_log (
  live_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     uuid NOT NULL REFERENCES comms_call(call_id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('caller','callee')),
  -- The client's own order for this side's segments; the recogniser emits
  -- them in sequence and the upsert keys on it, so a retried upload of the
  -- same segment list is idempotent.
  seq         int NOT NULL CHECK (seq >= 0),
  text        text NOT NULL,
  -- The recogniser runs in ONE language (the app language): the fallback is
  -- strong in that language and best-effort in the other, which is exactly
  -- why it is flagged (§4.5).
  language    text NOT NULL CHECK (language IN ('en','fr')),
  -- Milliseconds from the start of the side's recording, so a segment can be
  -- attributed to the part span it belongs to when the side falls back.
  started_ms  int CHECK (started_ms IS NULL OR started_ms >= 0),
  ended_ms    int CHECK (ended_ms IS NULL OR ended_ms >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_comms_call_live_log_seg UNIQUE (call_id, side, seq)
);

CREATE INDEX IF NOT EXISTS ix_comms_call_live_log_call
  ON comms_call_live_log (call_id, side, seq);

-- ── The summary draft the caller reviews and sends ─────────────────────────
CREATE TABLE IF NOT EXISTS comms_call_summary (
  summary_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ONE summary per call: the draft is a thing the caller acts on, and two
  -- drafts would be two things to act on.
  call_id       uuid NOT NULL UNIQUE REFERENCES comms_call(call_id) ON DELETE CASCADE,
  summary_text  text NOT NULL,
  -- [{ "text", "raised_by": "caller"|"callee" }] — VERBATIM in the language
  -- spoken (§4.10). Never translated, never re-worded: they are quotations
  -- from a certified channel.
  key_points    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "text", "owner": "caller"|"callee", "due": null | "YYYY-MM-DD" }]
  follow_ups    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The DRAFT language: the caller's app language at the time of drafting,
  -- switchable with one tap (§4.10). Applies to `summary_text` only.
  language      text NOT NULL CHECK (language IN ('en','fr')),
  -- What the draft is WORTH: 'groq' (every current transcript row certified),
  -- 'browser-live' (at least one side fell back to the live capture) or
  -- 'transcript-only' (the LLM was down; the attributed transcript IS the
  -- draft, labelled as such).
  provenance    text NOT NULL CHECK (provenance IN ('groq','browser-live','transcript-only')),
  draft_status  text NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (draft_status IN ('PENDING_REVIEW','SENT','DISCARDED')),
  -- Set when the caller posts it. NO code path posts without this write
  -- happening in the same transaction (decision row 3: there is no auto-post).
  sent_message_id uuid REFERENCES comms_message(message_id) ON DELETE SET NULL,
  -- §4.5 step 3: a summary that was already SENT when the record is upgraded
  -- is never rewritten. The caller is OFFERED an update instead — this flag
  -- is the offer — and the update lands as a second, clearly-labelled message.
  update_available boolean NOT NULL DEFAULT false,
  update_message_id uuid REFERENCES comms_message(message_id) ON DELETE SET NULL,
  -- How many times the caller flipped EN/FR on this draft. Bookkeeping for
  -- the one number that tells us whether the toggle is used.
  regenerate_count int NOT NULL DEFAULT 0 CHECK (regenerate_count >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_comms_call_summary_status
  ON comms_call_summary (draft_status);
CREATE INDEX IF NOT EXISTS ix_comms_call_summary_update
  ON comms_call_summary (update_available) WHERE update_available;

-- ── Call-level state of the never-dies chain (§4.5) ────────────────────────
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS transcription_state text;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS transcription_error text;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS transcription_attempts int NOT NULL DEFAULT 0;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS transcription_updated_at timestamptz;
-- The CALLER's app language at the time of the call — the language the summary
-- prose is drafted in (§4.10, decision row 8). Reported by the caller's client
-- with its upload (there is no per-user language column in the schema, and the
-- draft language belongs to the CALL anyway: it is what this draft was written
-- for, not a profile setting that can be changed afterwards).
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS summary_language text NOT NULL DEFAULT 'en';

-- ── Why there is no CHECK on transcription_state ───────────────────────────
--
-- The four states — PENDING, PROCESSING, CERTIFIED, TRANSCRIPTION_FAILED — are
-- enforced in the repo and the pipeline (smartcomm.call.repo.js
-- setTranscriptionState is the only writer, and the job handler is the only
-- caller). Deliberately NOT as a constraint on this table, which already
-- existed: a migration above 13791 may add PLAIN columns to a pre-existing
-- table and nothing else. 13791 repairs sandbox by mirroring the constraints it
-- finds in live, and a constraint added here would abort provisioning a new
-- tenant at that file — see tests/unit/migration-constraint-ordering.test.js.
--
-- The value set is small, written in one place, and read back only to render a
-- sentence, so the validator-and-service rule costs nothing real. If it were
-- ever violated, the call record would show a state the UI does not know, which
-- is a bug report rather than a corrupted record.

-- The daily reprocess sweep reads exactly the failed ones.
CREATE INDEX IF NOT EXISTS ix_comms_call_transcription_failed
  ON comms_call (transcription_updated_at) WHERE transcription_state = 'TRANSCRIPTION_FAILED';

-- The posted summary card is a normal message with a CALL attachment that
-- points at the call (the 13794 attachment model, extended by one kind).
--
-- A plain uuid column, NOT a REFERENCES: this is a pre-existing table, and the
-- provisioning hazard above applies to foreign keys as much as to CHECKs. The
-- writer (smartcomm.call.pipeline.service.sendSummary) sets it from the call row
-- it just resolved, so it cannot dangle in practice, and the READER is written
-- to survive it anyway — cardsForCallIds joins, a missing call simply produces
-- no card, and the bubble says "this record is no longer available" rather than
-- breaking the thread.
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS call_id uuid;
CREATE INDEX IF NOT EXISTS ix_comms_attachment_call
  ON comms_attachment (call_id) WHERE call_id IS NOT NULL;

-- ── Updated-at triggers (the house set_updated_at) ─────────────────────────
CREATE OR REPLACE TRIGGER trg_commscallrec_updated
  BEFORE UPDATE ON comms_call_recording
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_commscallsum_updated
  BEFORE UPDATE ON comms_call_summary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── The tenant half of the recording kill switch ───────────────────────────
-- ON by default: recording is the feature, and this row is what the tenant
-- admin turns OFF. A missing row 403s the recorder routes, so the seed is
-- what makes "default ON" true on a tenant that has never been re-projected.
INSERT INTO feature_state (feature_key, state, source)
VALUES ('call_recording', 'on', 'default')
ON CONFLICT (feature_key) DO NOTHING;

-- DOWN
-- DROP TRIGGER IF EXISTS trg_commscallrec_updated ON comms_call_recording;
-- DROP TRIGGER IF EXISTS trg_commscallsum_updated ON comms_call_summary;
-- DROP INDEX IF EXISTS ix_comms_attachment_call;
-- ALTER TABLE comms_attachment DROP COLUMN IF EXISTS call_id;
-- DROP INDEX IF EXISTS ix_comms_call_transcription_failed;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS summary_language;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS transcription_updated_at;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS transcription_attempts;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS transcription_error;
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS transcription_state;
-- DROP INDEX IF EXISTS ix_comms_call_summary_update;
-- DROP INDEX IF EXISTS ix_comms_call_summary_status;
-- DROP TABLE IF EXISTS comms_call_summary;
-- DROP INDEX IF EXISTS ix_comms_call_live_log_call;
-- DROP TABLE IF EXISTS comms_call_live_log;
-- DROP INDEX IF EXISTS uq_comms_call_transcript_current;
-- DROP TABLE IF EXISTS comms_call_transcript;
-- DROP INDEX IF EXISTS ix_comms_call_recording_retain;
-- DROP INDEX IF EXISTS ix_comms_call_recording_call;
-- DROP TABLE IF EXISTS comms_call_recording;
-- DELETE FROM feature_state WHERE feature_key = 'call_recording';
--
-- No DOWN for the transcripts and summaries on a tenant that has taken calls:
-- the text is the record (D7) and dropping it would be the one deletion this
-- programme exists to avoid. The DOWN above is for a migration applied to a
-- fresh database by mistake, before any call happened.
