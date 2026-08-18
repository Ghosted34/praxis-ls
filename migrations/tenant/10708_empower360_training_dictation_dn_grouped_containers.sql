-- ============================================================================
-- TENANT DB — 10708 empower 360°, training dictation and delivery-note
-- grouped containers.
--
-- Three unrelated data facts, one migration, each additive and idempotent:
--
--   1. TRAINING LIVE DICTATION. `training.minutes` (0702) already knows how to
--      fold a transcript into the minutes, but nothing ever stored one: the
--      table had a `transcript_vault_id` for the FILED document and no column
--      for the words. `transcript` is the running text a live mic appends to,
--      chunk by chunk, until the facilitator asks for minutes.
--
--   2. DELIVERY-NOTE GROUPED CONTAINERS. `delivery_note_container` could only
--      reference a per-box `dossier_container_unit`. A file in GROUPED mode
--      ("3 × 40' HC") has container LINES and no units at all, so the delivery
--      prefill and the picker offered nothing from it — the document that is
--      the whole point of capturing containers could not carry the file's
--      equipment. The line link, the type code and the quantity let a note
--      carry "3 × 40' HC" the same way the file states it.
--
--   3. APPRAISAL MANUAL SCORING. The manager's `rating` has existed since
--      before 0701, but nothing recorded WHEN it was set. `rated_at` gives the
--      calibration the same audit trail the evidence scorer (`ai_scored_at`)
--      already has.
-- ============================================================================

-- ── 1. Training: the running transcript ─────────────────────────────────────

ALTER TABLE training
  ADD COLUMN IF NOT EXISTS transcript text;

COMMENT ON COLUMN training.transcript IS
  'The running words captured by live dictation during the session, appended chunk by chunk. The source the minutes drafter folds in beside the typed notes.';

-- ── 2. Delivery note: grouped container lines ───────────────────────────────

ALTER TABLE delivery_note_container
  ADD COLUMN IF NOT EXISTS dossier_container_line_id uuid
    REFERENCES dossier_container_line(dossier_container_line_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS container_type_code text,
  -- How many of the type this note hands over. 1 for a per-box unit; the
  -- line's quantity for a grouped pick.
  ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1
    CHECK (qty > 0);

COMMENT ON COLUMN delivery_note_container.dossier_container_line_id IS
  'Set when the note carries a GROUPED line ("3 × 40'' HC") from a file with no per-box numbers yet. ON DELETE SET NULL, same rule as the unit link: correcting the file must never shorten a signed note.';
COMMENT ON COLUMN delivery_note_container.container_type_code IS
  'The container type code snapshot ("40HC"), so a printed note names the equipment even after the file is corrected.';

-- A container row is identified by a unit, a grouped line, or a typed number.
-- The old constraint predates grouped lines and would reject exactly the rows
-- this migration exists to allow, so it is replaced rather than amended.
DO $$ BEGIN
  ALTER TABLE delivery_note_container DROP CONSTRAINT IF EXISTS chk_dn_container_identified;
END $$;
DO $$ BEGIN
  ALTER TABLE delivery_note_container ADD CONSTRAINT chk_dn_container_identified
    CHECK (dossier_container_unit_id IS NOT NULL
           OR dossier_container_line_id IS NOT NULL
           OR (container_no IS NOT NULL AND btrim(container_no) <> ''));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_dn_container_line
  ON delivery_note_container (dossier_container_line_id)
  WHERE dossier_container_line_id IS NOT NULL;

-- ── 3. Appraisal: when the human scored it ──────────────────────────────────

ALTER TABLE appraisal
  ADD COLUMN IF NOT EXISTS rated_at timestamptz;

COMMENT ON COLUMN appraisal.rated_at IS
  'When a person set (or changed) `rating` — the calibration trail, beside the scorer''s `ai_scored_at`.';

-- DOWN
--   ALTER TABLE training DROP COLUMN IF EXISTS transcript;
--   DROP INDEX IF EXISTS ix_dn_container_line;
--   ALTER TABLE delivery_note_container DROP CONSTRAINT IF EXISTS chk_dn_container_identified;
--   ALTER TABLE delivery_note_container ADD CONSTRAINT chk_dn_container_identified
--     CHECK (dossier_container_unit_id IS NOT NULL
--            OR (container_no IS NOT NULL AND btrim(container_no) <> ''));
--   ALTER TABLE delivery_note_container
--     DROP COLUMN IF EXISTS qty,
--     DROP COLUMN IF EXISTS container_type_code,
--     DROP COLUMN IF EXISTS dossier_container_line_id;
--   ALTER TABLE appraisal DROP COLUMN IF EXISTS rated_at;
