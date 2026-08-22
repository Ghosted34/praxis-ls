-- ============================================================================
-- TENANT DB — 10789 Wet-signature inbound ingest queue.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §8.4–§8.6.
--
-- Every returned scan lands here before anyone claims it is a signature. The
-- decode state and the match state are deliberately separate: a clean barcode
-- can still fail corroboration and a no-barcode scan can still be bound by an
-- operator. A queue that says only "pending" teaches nobody what to fix.
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_ingest (
  ingest_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text NOT NULL,
  source_ref         text,
  document_vault_id  uuid NOT NULL REFERENCES document_vault(doc_id),
  decoded_code       text,
  decode_status      text NOT NULL DEFAULT 'PENDING',
  print_job_id       uuid REFERENCES signature_print_job(print_job_id),
  match_status       text NOT NULL DEFAULT 'PENDING',
  match_notes        text,
  processed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_ingest_source' AND conrelid = 'signature_ingest'::regclass) THEN
    ALTER TABLE signature_ingest ADD CONSTRAINT ck_sig_ingest_source
      CHECK (source IN ('UPLOAD','EMAIL','MOBILE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_ingest_decode' AND conrelid = 'signature_ingest'::regclass) THEN
    ALTER TABLE signature_ingest ADD CONSTRAINT ck_sig_ingest_decode
      CHECK (decode_status IN ('PENDING','DECODED','NO_BARCODE','UNREADABLE','FAILED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_ingest_match' AND conrelid = 'signature_ingest'::regclass) THEN
    ALTER TABLE signature_ingest ADD CONSTRAINT ck_sig_ingest_match
      CHECK (match_status IN ('PENDING','AUTO','REVIEW','MANUAL','REJECTED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_ingest_queue ON signature_ingest(match_status, created_at)
  WHERE match_status IN ('PENDING','REVIEW');
CREATE INDEX IF NOT EXISTS ix_ingest_print_job ON signature_ingest(print_job_id) WHERE print_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ingest_vault ON signature_ingest(document_vault_id);

COMMENT ON TABLE signature_ingest IS
  'Returned paper-signature scans awaiting DataMatrix decode and corroborated reconciliation.';
COMMENT ON COLUMN signature_ingest.decode_status IS
  'Barcode result only. NO_BARCODE and UNREADABLE both route to review, but tell the operator whether to rescan or search manually.';
COMMENT ON COLUMN signature_ingest.match_status IS
  'Reconciliation result. AUTO and MANUAL are evidence claims with different weight and are printed differently on the certificate.';

-- ============================================================================
-- VERIFY
--   SELECT to_regclass('signature_ingest');
--   SELECT conname FROM pg_constraint WHERE conrelid = 'signature_ingest'::regclass ORDER BY conname;
--
-- DOWN
--   -- DESTRUCTIVE: loses the review queue for returned paper signatures.
--   -- DROP TABLE IF EXISTS signature_ingest;
-- ============================================================================
