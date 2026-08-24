-- ============================================================================
-- TENANT DB — 10788 Wet-signature print jobs.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §8.1–§8.3.
--
-- A print job is NOT a signature. It is the auditable fact that a paper copy was
-- issued with a reconciliation code on it. The signature row is written only
-- when a returned scan is matched back to this job (§8.6). `print_code` is clear
-- text deliberately: it is an internal matching key printed on paper, not a
-- credential. Knowing it grants no access to the verification portal and signs
-- nothing by itself.
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_print_job (
  print_job_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid REFERENCES signature_request(request_id) ON DELETE SET NULL,
  party_id           uuid REFERENCES signature_party(party_id) ON DELETE SET NULL,
  entity_ref         text NOT NULL,
  doc_type           text NOT NULL,
  document_vault_id  uuid REFERENCES document_vault(doc_id),
  content_hash       text NOT NULL,

  print_code         text NOT NULL,
  reprint_of         uuid REFERENCES signature_print_job(print_job_id),
  reprint_no         smallint NOT NULL DEFAULT 0,

  status             text NOT NULL DEFAULT 'ISSUED',
  printed_at         timestamptz,
  reconciled_at      timestamptz,
  reconciled_by      uuid REFERENCES app_user(user_id),
  scan_vault_id      uuid REFERENCES document_vault(doc_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigprint_status' AND conrelid = 'signature_print_job'::regclass) THEN
    ALTER TABLE signature_print_job ADD CONSTRAINT ck_sigprint_status
      CHECK (status IN ('ISSUED','PRINTED','SCANNED','RECONCILED','REVIEW','REJECTED','VOIDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigprint_code_shape' AND conrelid = 'signature_print_job'::regclass) THEN
    ALTER TABLE signature_print_job ADD CONSTRAINT ck_sigprint_code_shape
      CHECK (print_code ~ '^[0-9A-HJKMNP-TV-Z]{18}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigprint_reprint_no' AND conrelid = 'signature_print_job'::regclass) THEN
    ALTER TABLE signature_print_job ADD CONSTRAINT ck_sigprint_reprint_no
      CHECK (reprint_no >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_printjob_code ON signature_print_job(print_code);
CREATE INDEX IF NOT EXISTS ix_printjob_open ON signature_print_job(status, created_at)
  WHERE status IN ('ISSUED','PRINTED');
CREATE INDEX IF NOT EXISTS ix_printjob_request ON signature_print_job(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_printjob_entity ON signature_print_job(entity_ref);

COMMENT ON TABLE signature_print_job IS
  'Paper-signature print jobs. A row means a copy was issued with a DataMatrix reconciliation code. The document_signature row is written only after a returned scan is reconciled.';
COMMENT ON COLUMN signature_print_job.print_code IS
  '18-character Crockford DataMatrix payload, stored in clear because it is an internal reconciliation key, not a verification credential.';
COMMENT ON COLUMN signature_print_job.reprint_of IS
  'A reprint mints a new code and points here. Two signed paper copies can both be attributed without pretending they are the same copy.';

-- ============================================================================
-- VERIFY
--   SELECT to_regclass('signature_print_job');
--   SELECT indexname FROM pg_indexes WHERE tablename = 'signature_print_job' ORDER BY indexname;
--
-- DOWN
--   -- DESTRUCTIVE: loses the chain from returned scans to printed paper.
--   -- DROP TABLE IF EXISTS signature_print_job;
-- ============================================================================
