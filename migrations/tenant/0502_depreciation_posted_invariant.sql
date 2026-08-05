-- 0502 — A posted depreciation row must name the entry it posted.
--
-- NEW-05 (Critical), found during this remediation rather than in the original
-- audit, and it is the residue of DATA 5.5.
--
-- `asset.service.depreciate` marked the schedule row `posted = true` and THEN
-- posted the journal entry, outside a transaction. When the posting threw, the
-- row stayed `posted = true` with `entry_id` NULL: the register says the
-- depreciation has been taken, the ledger says it has not, and every subsequent
-- run skips the period because it is already marked posted. Depreciation is
-- silently never recorded for that asset, forever.
--
-- The code path is fixed (5.5 wrapped it and posts before marking). This makes
-- the broken STATE unrepresentable, which is the part that matters: a future
-- edit that reintroduces the ordering fails loudly at the database instead of
-- corrupting the fixed-asset register again.
--
-- The converse is deliberately allowed. `entry_id IS NOT NULL AND posted =
-- false` is a legitimate intermediate — the entry exists and the row is about
-- to be marked — and forbidding it would break the corrected ordering.
--
-- NOT VALID: rows in exactly the broken state ALREADY EXIST in production.
-- Validating now would fail the migration on the very data this is meant to
-- catch. Run scripts/db/reconcile-depreciation.js first — it finds those rows
-- and posts the missing entries — then:
--
--   ALTER TABLE depreciation_schedule VALIDATE CONSTRAINT chk_depreciation_posted_has_entry;

-- Guarded like 0499: re-runnable, and a drifted schema is reported by name
-- rather than rolling the file back (DATA 3.3).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'chk_depreciation_posted_has_entry'
                AND connamespace = current_schema()::regnamespace) THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE depreciation_schedule ADD CONSTRAINT chk_depreciation_posted_has_entry
  CHECK (posted = false OR entry_id IS NOT NULL) NOT VALID';
EXCEPTION
  WHEN undefined_table OR undefined_column THEN
    RAISE WARNING '[0502] %: chk_depreciation_posted_has_entry skipped — %', current_schema(), SQLERRM;
END $$;
COMMENT ON CONSTRAINT chk_depreciation_posted_has_entry ON depreciation_schedule IS
  'A row marked posted must name its journal entry. Guards the DATA 5.5 ordering bug (NEW-05).';

-- Finding the damaged rows is a one-liner once the constraint names the shape:
--   SELECT * FROM depreciation_schedule WHERE posted AND entry_id IS NULL;

-- DOWN
-- ALTER TABLE depreciation_schedule DROP CONSTRAINT IF EXISTS chk_depreciation_posted_has_entry;
