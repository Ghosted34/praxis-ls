-- ============================================================================
-- TENANT DB — 10716 reconciliation follow-ups: OCR provenance (MOD-09).
--
-- Closes one of the three gaps left open by 10709: a scanned statement can now
-- be read, and the fact that a machine read it has to be part of the record.
--
-- WHY THIS IS A COLUMN AND NOT AN IMPLEMENTATION DETAIL.
--
-- Every other statement source in this module is a FILE THE INSTITUTION WROTE.
-- A CSV, an .xlsx, a camt.053 — the bank asserted those figures, and if they
-- are wrong the bank is wrong. An OCR'd scan is different in kind: the figures
-- are our best reading of a photograph, and the institution asserted nothing we
-- can point at. That distinction belongs on the row, not in a log line, because
-- the question an auditor asks two years later is precisely "where did this
-- number come from" — and "a model read it off an image" is a materially
-- different answer from "the bank's system exported it".
--
-- So: `ocr_used` marks it, `ocr_provider` and `ocr_model` say who read it, and
-- `ocr_page_count` says how much of the document was interpreted rather than
-- parsed. A reconciliation built on an OCR'd statement can still be approved —
-- the footing arithmetic in reconciliation.rules.js §6 checks it exactly as it
-- checks any other source — but the provenance travels with it.
--
-- ADDITIVE ONLY. Idempotent — safe to re-run.
-- SCHEMA-DUAL. Runs UNQUALIFIED, once per schema (live, then sandbox).
-- ============================================================================

ALTER TABLE bank_statement
  -- Was any part of this statement read by OCR rather than parsed from a
  -- machine-written file? Default false: every existing row was parsed.
  ADD COLUMN IF NOT EXISTS ocr_used       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_provider   text,
  ADD COLUMN IF NOT EXISTS ocr_model      text,
  ADD COLUMN IF NOT EXISTS ocr_page_count integer
    CHECK (ocr_page_count IS NULL OR ocr_page_count >= 0);

-- Coherence: a statement that names an OCR provider must be marked as OCR'd,
-- and one marked as OCR'd must say who did the reading. Either half alone is a
-- provenance record that cannot be acted on.
DO $$ BEGIN
  ALTER TABLE bank_statement DROP CONSTRAINT IF EXISTS chk_statement_ocr_stamped;
  ALTER TABLE bank_statement
    ADD CONSTRAINT chk_statement_ocr_stamped
    CHECK (
      (ocr_used = false AND ocr_provider IS NULL)
      OR (ocr_used = true AND ocr_provider IS NOT NULL)
    );
END $$;

CREATE INDEX IF NOT EXISTS ix_statement_ocr
  ON bank_statement (treasury_account_id) WHERE ocr_used = true;

COMMENT ON COLUMN bank_statement.ocr_used IS
  'True when the figures were read off a scan by OCR rather than parsed from a machine-written export. An auditor asking "where did this number come from" needs this distinction: the institution asserted nothing we can point at.';

-- DOWN
--   DROP INDEX IF EXISTS ix_statement_ocr;
--   ALTER TABLE bank_statement DROP CONSTRAINT IF EXISTS chk_statement_ocr_stamped;
--   ALTER TABLE bank_statement
--     DROP COLUMN IF EXISTS ocr_page_count,
--     DROP COLUMN IF EXISTS ocr_model,
--     DROP COLUMN IF EXISTS ocr_provider,
--     DROP COLUMN IF EXISTS ocr_used;
