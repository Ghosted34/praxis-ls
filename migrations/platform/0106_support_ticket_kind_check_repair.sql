-- ============================================================================
-- PLATFORM DB — 0106 Repair: the nine kinds never actually took effect
--
-- 0105 widened platform.support_ticket's `kind` CHECK from three kinds to
-- nine. It did not work. Raising a ticket as URGENT, BILLING, SECURITY, DATA,
-- COMMS or REQUEST failed with SQLSTATE 23514, which the API surfaces as
-- "A value violates a domain constraint".
--
-- ── WHAT 0105 GOT WRONG ─────────────────────────────────────────────────────
--
-- It opened with
--
--     ALTER TABLE platform.support_ticket
--       DROP CONSTRAINT IF EXISTS platform_support_ticket_kind_check;
--
-- intending to remove the three-kind CHECK that 0030 declared inline:
--
--     kind text NOT NULL DEFAULT 'SUPPORT' CHECK (kind IN ('SUPPORT','BUG','FEATURE'))
--
-- but THAT IS NOT WHAT POSTGRES CALLED IT. An unnamed column CHECK is named
-- `<table>_<column>_check` — the SCHEMA IS NOT PART OF THE NAME. So 0030's
-- constraint is `support_ticket_kind_check`, the DROP named a constraint that
-- has never existed anywhere (it logged `does not exist, skipping` and carried
-- on), and the ADD that followed created a SECOND, nine-kind CHECK beside the
-- surviving three-kind one.
--
-- Two CHECKs on one column are ANDed. The effective set stayed SUPPORT, BUG,
-- FEATURE, and the six new kinds were rejected by a constraint 0105 believed
-- it had already removed.
--
-- The `platform_` prefix most likely came from 0031, which legitimately drops
-- `platform_user_role_check` — that reads like a schema prefix and is not one.
-- The table there is literally named `platform_user`, so the auto-generated
-- name is `<platform_user>_<role>_check`. The precedent was misleading.
--
-- ── WHY THIS IS A NEW FILE AND NOT AN EDIT TO 0105 ──────────────────────────
--
-- 0105 is applied. The migrator keys its ledger on filename, so editing it
-- re-runs nowhere and trips contentDrift across the fleet. The repair has to
-- be its own file, as 13791 was for the constraint-guard audit.
--
-- ── WHY THE SWEEP IS BY DEFINITION, NOT BY NAME ─────────────────────────────
--
-- Naming the constraint is exactly the mistake being repaired, so this does
-- not name it. It drops EVERY CHECK on platform.support_ticket that mentions
-- `kind` and is not the nine-kind constraint, whatever any of them are called.
-- That repairs the database 0105 left behind, a database that never ran 0105,
-- and one where the constraint carries a name nobody predicted, with the same
-- file.
-- ============================================================================

-- Sweep away every stale `kind` CHECK, by definition rather than by name.
DO $$
DECLARE stale record;
BEGIN
  FOR stale IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t      ON t.oid = c.conrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
     WHERE n.nspname = 'platform'
       AND t.relname = 'support_ticket'
       AND c.contype  = 'c'
       AND c.conname <> 'platform_support_ticket_kind_check'
       AND pg_get_constraintdef(c.oid) LIKE '%kind%'
  LOOP
    EXECUTE format(
      'ALTER TABLE platform.support_ticket DROP CONSTRAINT IF EXISTS %I', stale.conname
    );
  END LOOP;
END $$;

-- And make sure the nine-kind CHECK is present. The guard is schema-qualified
-- on the LITERAL 'platform' rather than current_schema(): every table in this
-- file is explicitly platform-qualified, the platform database has no
-- live/sandbox pair to confuse, and current_schema() is what made 0105's own
-- guard never match its target.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t      ON t.oid = c.conrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
     WHERE c.conname = 'platform_support_ticket_kind_check'
       AND t.relname = 'support_ticket'
       AND n.nspname = 'platform'
  ) THEN
    ALTER TABLE platform.support_ticket
      ADD CONSTRAINT platform_support_ticket_kind_check
      CHECK (kind IN ('SUPPORT','BUG','FEATURE','BILLING','SECURITY','DATA','COMMS','URGENT','REQUEST'));
  END IF;
END $$;

-- DOWN
-- Reversible only in the sense 0105 was: restoring the three-kind CHECK is
-- safe exactly while no ticket has been filed under one of the six new kinds.
-- After this migration those kinds finally work, so by the time anyone wants
-- to reverse it there will be rows to consider — delete or remap them first,
-- or restore the pre-deploy dump.
--
-- ALTER TABLE platform.support_ticket
--   DROP CONSTRAINT IF EXISTS platform_support_ticket_kind_check;
-- ALTER TABLE platform.support_ticket
--   ADD CONSTRAINT support_ticket_kind_check
--   CHECK (kind IN ('SUPPORT','BUG','FEATURE'));
