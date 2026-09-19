-- ============================================================================
-- TENANT DB — 13953 currency-usage index coverage (MOD-08, audit #10).
--
-- WHY. Currency 360 answers "where is this currency used?" by counting rows in
-- every table that has a FK to currency(code) — currency.repo.usageForCode()
-- introspects pg_constraint for those columns and runs one COUNT(*) per column.
-- Without an index on the referencing column each COUNT is a sequential scan, so
-- the usage panel's cost grows with the size of every commercial/finance table
-- it touches. Deleting a currency runs the same scan (the in-use guard), so the
-- cost is on the write path too.
--
-- WHAT. Create a btree index on EVERY currency-referencing FK column that does
-- not already have one leading with that column. Done dynamically from the same
-- catalogue view the app uses, so the set stays correct as new FK columns are
-- added by later migrations — no hand-maintained list to drift.
--
-- fx_rate_daily is skipped: base_code/quote_code are already covered by the
-- table's own unique/lookup indexes, and usageForCode() excludes it anyway
-- (rates are not "usage").
--
-- Additive + idempotent: only CREATE INDEX IF NOT EXISTS, generated names, no
-- data rewrite. Safe to re-run.
-- ============================================================================

DO $$
DECLARE
  r          record;
  idx_name   text;
  has_index  boolean;
BEGIN
  FOR r IN
    SELECT con.conrelid              AS relid,
           con.conrelid::regclass::text AS tbl,
           att.attname               AS col,
           con.conkey[1]             AS first_attnum
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = con.conkey[1]          -- leading FK column only
     WHERE con.contype = 'f'
       AND con.confrelid = 'currency'::regclass
       AND con.conrelid::regclass::text NOT LIKE '%fx_rate_daily'
  LOOP
    -- Already covered if any index leads with this column.
    SELECT EXISTS (
      SELECT 1
        FROM pg_index i
       WHERE i.indrelid = r.relid
         AND i.indkey[0] = r.first_attnum
    ) INTO has_index;

    IF NOT has_index THEN
      -- Deterministic, collision-safe name (regclass text can include a schema).
      idx_name := 'ix_curfk_' || substr(md5(r.tbl || '.' || r.col), 1, 16);
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %s (%I)',
        idx_name, r.tbl, r.col
      );
    END IF;
  END LOOP;
END $$;

-- DOWN
-- Additive; dropping loses only the query-planner coverage for the usage scan.
-- The generated indexes are named ix_curfk_<hash>; drop them individually if a
-- rollback is ever needed:
--   -- DESTRUCTIVE: DROP INDEX IF EXISTS ix_curfk_<hash>;
