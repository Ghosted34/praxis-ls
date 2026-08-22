-- ============================================================================
-- TENANT DB — 10791 Wet-signature unreconciled compliance rule.
--
-- The checker catalogue is code-backed, so there is no separate rule table to
-- seed here. 10773 already seeded `signature_policy.unreconciled_days`; this
-- migration adds the scan index and documents the database side of the rule.
--
-- Idempotent. Re-runnable.
-- ============================================================================

INSERT INTO setting (section, key, value)
VALUES ('signature_policy', 'unreconciled_days', '7'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_printjob_unreconciled_due ON signature_print_job(created_at)
  WHERE status IN ('ISSUED','PRINTED');

COMMENT ON INDEX ix_printjob_unreconciled_due IS
  'Feeds compliance rule signature.wet_unreconciled. The rule scans ISSUED/PRINTED print jobs older than signature_policy.unreconciled_days.';

-- ============================================================================
-- VERIFY
--   SELECT value FROM setting WHERE section = 'signature_policy' AND key = 'unreconciled_days';
--   SELECT indexname FROM pg_indexes WHERE indexname = 'ix_printjob_unreconciled_due';
--
-- DOWN
--   -- DELETE FROM setting WHERE section = 'signature_policy' AND key = 'unreconciled_days';
--   -- DROP INDEX IF EXISTS ix_printjob_unreconciled_due;
-- ============================================================================
