-- ============================================================================
-- TENANT — 13791 Give the sandbox schema back the constraints it never got.
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
--
-- `pg_constraint` is DATABASE-wide. `conname` is unique per TABLE, not per
-- database, so a guard written as
--
--     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_x')
--
-- matches that name on ANY schema's copy of the table. A tenant database has
-- two — `live` and `sandbox` — and `provisioning.service.js` migrates them in
-- that order (`for (const schema of ["live", "sandbox"])`). So live created the
-- constraint, and sandbox then found LIVE's row, took the branch as false, and
-- silently skipped its own ADD.
--
-- Nothing raised. A skipped ADD is not an error, and almost every one of these
-- rules is also enforced by a Zod validator on the write path, so no request
-- ever reached the missing CHECK. It was found when 13790 put a
-- `COMMENT ON CONSTRAINT` after such a guard — the first statement in the
-- repository that REQUIRED the constraint to exist in the schema it had just
-- pretended to create it in.
--
-- ── THE MEASURED DAMAGE ────────────────────────────────────────────────────
--
-- Audited by provisioning a tenant with the real migrator (310 files against
-- each schema) and diffing `pg_constraint`:
--
--     live     1883 constraints
--     sandbox  1772 constraints
--     missing   111  — 107 CHECK, 4 FOREIGN KEY, across 48 tables
--     extra       0  — live is a strict superset, which is what makes it
--                      safe to treat live as the reference below
--
-- 48 migrations carry the bad guard, the oldest being 0464_ledger_hardening.
-- LIVE IS UNAFFECTED: it always wins the race, so production data has always
-- been fully constrained. The gap is sandbox — TEST MODE — where a row can
-- hold a state the schema is supposed to forbid, so a test can pass against
-- data that live would have rejected.
--
-- ── WHY THIS IS A NEW FILE AND NOT 48 EDITS ───────────────────────────────
--
-- Editing the 48 originals is the obvious fix and it is the wrong one, twice:
--
--   1. IT WOULD REPAIR NOTHING. `appliedSet` keys the ledger on FILENAME, so an
--      edited file that is already recorded is skipped on every existing
--      tenant. Only brand-new tenants would see the change — and the tenants
--      that need it are the ones that already exist.
--   2. IT WOULD BREAK THE FLEET CHECK. `contentDrift` compares each applied
--      file's sha256 against the ledger. Editing 48 applied files reports every
--      tenant in the fleet as content-drifted, which is a real alarm made
--      permanently useless.
--
-- A new file runs everywhere, once, and leaves the ledger honest.
--
-- ── WHY IT MIRRORS `live` RATHER THAN LISTING 111 STATEMENTS ──────────────
--
-- Because the correct definition of each constraint is whatever the ORIGINAL
-- migration ended up producing, after every later migration that altered it.
-- Re-typing 111 of those by hand is 111 chances to restore a definition that
-- was superseded in 2026. `live` already holds the answer, per tenant, and the
-- audit proved it is a strict superset.
--
-- ── THE FOREIGN KEYS ARE THE REASON TO READ THIS BLOCK TWICE ──────────────
--
-- `pg_get_constraintdef` returns a RESOLVED definition, and all four missing
-- FKs resolved against the schema they were created in:
--
--     FOREIGN KEY (entity_id) REFERENCES live.corporate_entity(entity_id)
--
-- Copied verbatim into `sandbox`, that is a foreign key pointing from TEST data
-- at PRODUCTION rows: sandbox writes would start depending on live contents,
-- and deleting a live entity would be blocked by a sandbox row referencing it.
-- So the reference is retargeted to the schema being repaired, and any
-- definition that STILL names the reference schema afterwards is skipped with a
-- warning rather than executed. A missing constraint is a known gap; a
-- cross-schema one is a new and worse defect.
--
-- ── WHY A FAILED VALIDATION FALLS BACK TO `NOT VALID` ─────────────────────
--
-- Sandbox has been unconstrained for its whole life, so it may already hold
-- rows that violate a rule being restored. A plain ADD CONSTRAINT scans the
-- table and would ABORT THE DEPLOY over test data. Adding it NOT VALID instead
-- enforces the rule on everything written from now on and leaves the existing
-- rows alone, which is the honest split: stop the bleeding, do not pretend the
-- history was clean. The constraint can be validated later, per tenant, once
-- the offending sandbox rows are cleaned or wiped:
--
--     ALTER TABLE sandbox.<table> VALIDATE CONSTRAINT <name>;
--
-- Validated is attempted FIRST, so a clean tenant — every fresh provision, and
-- most real ones — gets fully valid constraints and no NOT VALID marker.
-- ============================================================================

DO $$
DECLARE
  target  text := current_schema();
  ref     text := 'live';
  r       record;
  def     text;
  added   int := 0;
  novalid int := 0;
  skipped int := 0;
BEGIN
  -- `live` is the reference and cannot be repaired from itself. This also makes
  -- the file a no-op on the live pass of every provision, which is why it is
  -- safe to keep in the ordinary tenant set rather than as a one-off script.
  IF target = ref THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT t.relname AS tbl,
           con.conname AS nm,
           pg_get_constraintdef(con.oid) AS cdef
      FROM pg_constraint con
      JOIN pg_class t     ON t.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = ref
       -- CHECK and FOREIGN KEY only. Primary keys and uniques arrive with their
       -- index and were never subject to this guard; excluding them keeps this
       -- from inventing an index on a table it does not own.
       AND con.contype IN ('c', 'f')
       AND NOT con.conislocal IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM pg_constraint c2
           JOIN pg_class t2     ON t2.oid = c2.conrelid
           JOIN pg_namespace n2 ON n2.oid = t2.relnamespace
          WHERE n2.nspname = target
            AND t2.relname = t.relname
            AND c2.conname = con.conname)
     ORDER BY t.relname, con.conname
  LOOP
    -- The table itself must exist here. A table created in live by a migration
    -- that sandbox legitimately skipped is not this file's business.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class t3
        JOIN pg_namespace n3 ON n3.oid = t3.relnamespace
       WHERE n3.nspname = target AND t3.relname = r.tbl AND t3.relkind = 'r')
    THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    def := replace(r.cdef, 'REFERENCES ' || ref || '.', 'REFERENCES ' || target || '.');

    -- Fail closed. If the reference schema is still named anywhere in the
    -- definition, this would wire test data to production rows — skip loudly.
    IF def ~ ('\m' || ref || '\.') THEN
      RAISE WARNING '[13791] % .% still references %; skipped', r.tbl, r.nm, ref;
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', target, r.tbl, r.nm, def);
      added := added + 1;
    EXCEPTION
      WHEN check_violation OR foreign_key_violation THEN
        -- Pre-existing sandbox rows break the rule. Enforce it going forward
        -- rather than failing the deploy over test data.
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s NOT VALID', target, r.tbl, r.nm, def);
        novalid := novalid + 1;
        RAISE WARNING '[13791] %.% added NOT VALID — existing rows violate it', r.tbl, r.nm;
    END;
  END LOOP;

  RAISE NOTICE '[13791] schema %: % restored, % NOT VALID, % skipped', target, added, novalid, skipped;
END $$;

-- ============================================================================
-- VERIFY
--   -- Nothing in live that is missing from sandbox (expect 0):
--   WITH c AS (
--     SELECT n.nspname AS s, t.relname AS tbl, con.conname AS nm
--       FROM pg_constraint con
--       JOIN pg_class t     ON t.oid = con.conrelid
--       JOIN pg_namespace n ON n.oid = t.relnamespace
--      WHERE n.nspname IN ('live','sandbox') AND con.contype IN ('c','f'))
--   SELECT count(*) FROM (
--     SELECT tbl, nm FROM c WHERE s='live'
--     EXCEPT SELECT tbl, nm FROM c WHERE s='sandbox') x;
--
--   -- No sandbox constraint may reference live (expect 0):
--   SELECT count(*) FROM pg_constraint con
--     JOIN pg_class t ON t.oid=con.conrelid
--     JOIN pg_namespace n ON n.oid=t.relnamespace
--    WHERE n.nspname='sandbox' AND pg_get_constraintdef(con.oid) ~ '\mlive\.';
--
--   -- Anything left unvalidated, to clean up per tenant at leisure:
--   SELECT t.relname, con.conname FROM pg_constraint con
--     JOIN pg_class t ON t.oid=con.conrelid
--     JOIN pg_namespace n ON n.oid=t.relnamespace
--    WHERE n.nspname='sandbox' AND NOT con.convalidated;
--
-- DOWN
--   -- Deliberately none. This file only ever ADDS a constraint that `live`
--   -- already enforces, so reverting it would mean re-opening the exact gap it
--   -- closes. To undo a single one, drop it by name:
--   --   ALTER TABLE sandbox.<table> DROP CONSTRAINT <name>;
-- ============================================================================
