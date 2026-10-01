-- ============================================================================
-- PLATFORM DB — 0111 backup_run learns about OBJECT_RESTORE (§3.2, WS-B2)
-- ============================================================================
--
-- 0094 created `backup_run` with four kinds: PG_DUMP, WAL, OBJECT_SYNC,
-- SNAPSHOT_SCAN. Those are the four things the system could DO at the time,
-- and the omission is telling: objects could be copied offsite and scanned,
-- but never copied BACK. There was no restore path for documents at all, so
-- there was nothing to record.
--
-- `object-backup.service.restoreTenantObjects` is that missing inverse, and it
-- has to be recorded for the same reason every other attempt is: the value of
-- this table is that a failure is a ROW rather than a log line somebody would
-- have to know to look for. A restore that could not find half the documents
-- offsite is precisely the event nobody must be allowed to miss, and during an
-- incident it is also the event least likely to be watched live.
--
-- WHY THE SWEEP IS BY DEFINITION AND NOT BY NAME
--
--   Following 0106, which exists because 0105 guessed a constraint name wrong
--   and produced two ANDed CHECKs — the widened one and the surviving old one
--   — so the new values stayed rejected by a constraint the author believed
--   had been dropped. An unnamed column CHECK is named `<table>_<column>_check`
--   and the SCHEMA IS NOT PART OF THE NAME. Rather than rely on that, this
--   drops every CHECK on `backup_run` that mentions `kind` and is not the one
--   being installed, whatever any of them happen to be called.
--
-- Idempotent and additive: widening a CHECK rejects no existing row.
--
-- DOWN
-- Safe only while no OBJECT_RESTORE row exists; after one is written the old
-- four-value CHECK cannot be re-applied without deleting history.
-- ALTER TABLE platform.backup_run
--   DROP CONSTRAINT IF EXISTS platform_backup_run_kind_check;
-- ALTER TABLE platform.backup_run
--   ADD CONSTRAINT backup_run_kind_check
--   CHECK (kind IN ('PG_DUMP','WAL','OBJECT_SYNC','SNAPSHOT_SCAN'));

DO $$
DECLARE stale record;
BEGIN
  FOR stale IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t      ON t.oid = c.conrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
     WHERE n.nspname = 'platform'
       AND t.relname = 'backup_run'
       AND c.contype = 'c'
       AND c.conname <> 'platform_backup_run_kind_check'
       AND pg_get_constraintdef(c.oid) LIKE '%kind%'
  LOOP
    EXECUTE format(
      'ALTER TABLE platform.backup_run DROP CONSTRAINT IF EXISTS %I', stale.conname
    );
  END LOOP;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t      ON t.oid = c.conrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
     WHERE c.conname = 'platform_backup_run_kind_check'
       AND t.relname = 'backup_run'
       AND n.nspname = 'platform'
  ) THEN
    ALTER TABLE platform.backup_run
      ADD CONSTRAINT platform_backup_run_kind_check
      CHECK (kind IN ('PG_DUMP','WAL','OBJECT_SYNC','SNAPSHOT_SCAN','OBJECT_RESTORE'));
  END IF;
END $$;

-- DOWN
-- ALTER TABLE platform.backup_run
--   DROP CONSTRAINT IF EXISTS platform_backup_run_kind_check;
-- ALTER TABLE platform.backup_run
--   ADD CONSTRAINT backup_run_kind_check
--   CHECK (kind IN ('PG_DUMP','WAL','OBJECT_SYNC','SNAPSHOT_SCAN'));
