-- ============================================================================
-- TENANT DB — 10711 Operational Cost Reconciliation (OCR) as a signed
-- document (G19)
--
-- The legacy's `api/ocr/` was a controlled document: one record per ops file,
-- DRAFT → SUBMITTED → VALIDATED | REJECTED, with submitted_by/at,
-- validated_by/at, rejected_by/at and a reject_reason; validation wrote back
-- to the ops file (ocr_id, ocr_amount, ocr_status='VALIDATED') and the sign-
-- off is what closed the file financially. The rebuild had only a live query
-- (`{ budget, actual, variance }`) with no record, no line level, no maker-
-- checker, nothing stamped on the dossier.
--
-- These tables restore the controlled document. Line-level budget vs actual
-- per costing item, a document reference per line, maker-checker transitions,
-- and the write-back columns on dossier so the signed amount is part of the
-- file's record.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dossier_reconciliation (
  reconciliation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id        uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','VALIDATED','REJECTED')),
  submitted_by      uuid REFERENCES app_user(user_id),
  submitted_at      timestamptz,
  validated_by      uuid REFERENCES app_user(user_id),
  validated_at      timestamptz,
  rejected_by       uuid REFERENCES app_user(user_id),
  rejected_at       timestamptz,
  reject_reason     text,
  ocr_amount        numeric(18,2),
  created_by        uuid REFERENCES app_user(user_id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_dossier_recon
  ON dossier_reconciliation(dossier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dossier_reconciliation_line (
  line_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id  uuid NOT NULL REFERENCES dossier_reconciliation(reconciliation_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  item_code          text,
  item_label         text,
  budget_ttc         numeric(18,2) NOT NULL DEFAULT 0,
  actual_ttc         numeric(18,2) NOT NULL DEFAULT 0,
  doc_ref            text,
  doc_required       boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_dossier_recon_line
  ON dossier_reconciliation_line(reconciliation_id);

-- Write-back columns on the ops file, mirroring the legacy's ocr_* columns.
ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS ocr_reconciliation_id uuid REFERENCES dossier_reconciliation(reconciliation_id),
  ADD COLUMN IF NOT EXISTS ocr_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS ocr_status text;

-- DOWN
--   ALTER TABLE dossier
--     DROP COLUMN IF EXISTS ocr_status,
--     DROP COLUMN IF EXISTS ocr_amount,
--     DROP COLUMN IF EXISTS ocr_reconciliation_id;
--   DROP TABLE IF EXISTS dossier_reconciliation_line;
--   DROP TABLE IF EXISTS dossier_reconciliation;
