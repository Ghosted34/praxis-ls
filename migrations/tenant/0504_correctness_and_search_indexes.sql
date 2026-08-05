-- 0504 — Indexes for correctness-gating queries (DATA 7.2) and text search (PERF S16).
--
-- Two findings, one migration, because they are the same operation and the
-- build cost is paid once.
--
-- PART 1 — DATA 7.2. Seven composite indexes on columns that gate
-- CORRECTNESS-critical queries, not merely slow ones. The one worth naming:
-- `accounting_period(entity_id, starts_on, ends_on)` backs `getPeriodForDate`,
-- which runs on EVERY SINGLE journal post — the hottest lookup in the
-- accounting engine had no supporting index at all.
--
-- PART 2 — PERF S16. `resource.js` and the hand-rolled repos all build
-- `ILIKE '%' || q || '%'`. A leading wildcard cannot use a B-tree, so every
-- free-text search is a sequential scan. Measured in the audit at
-- 66.96 ms -> 4.55 ms (14.7x) with a pg_trgm GIN index — and with NO query
-- rewrite: the same SQL simply becomes indexable.
--
-- WHY THE DO BLOCK RATHER THAN A FLAT LIST
--
-- The search-column list was derived by static analysis of the repos, and a
-- `col ILIKE` in a function that joins two tables cannot always be attributed
-- to the right one from the source alone. Rather than ship a list I could not
-- fully verify — and fail the migration for every tenant on the first wrong
-- pair — each index is created only if the column actually exists and is a
-- text type. A pair that does not resolve raises a NOTICE naming it.
--
-- That is deliberately NOT `EXCEPTION WHEN OTHERS THEN NULL` (DATA 3.6): the
-- check is a precondition tested explicitly, and anything unexpected still
-- aborts the migration. A skipped pair is reported, never swallowed.
--
-- Plain CREATE INDEX, not CONCURRENTLY: the migrator sends each file as one
-- multi-statement simple query, which Postgres wraps in an implicit
-- transaction block, and CONCURRENTLY cannot run there. Same reasoning as 0496
-- and 0500.
--
-- ROLLBACK: every object here is an index. `DROP INDEX IF EXISTS <name>;` for
-- each is safe at any time and loses no data.

-- ── Part 1: correctness-gating composites (DATA 7.2) ────────────────────────
--
-- Guarded exactly like part 2 and for the same reason 0496/0500 now are: the
-- migration files and the live schema have drifted (DATA 3.3), and one missing
-- column in a file the migrator runs as a single implicit transaction rolls
-- back everything else in it.

DO $$
DECLARE
  spec    text[];
  specs   text[][] := ARRAY[
    -- Every receivables read filters on both (smart_receivables.repo.js:34).
    ARRAY['idx_invoice_status_type', 'invoice', 'status, type'],
    -- The GROUP BY driving `outstanding` in that same query.
    ARRAY['idx_payment_allocation_invoice_id', 'payment_allocation', 'invoice_id'],
    -- Trial balance and statements aggregate on this pair; only the
    -- single-column ix_line_account existed.
    ARRAY['idx_journal_line_account_entry', 'journal_line', 'account_code, entry_id'],
    -- Period close and statement snapshots.
    ARRAY['idx_journal_entry_entity_period_status', 'journal_entry', 'entity_id, period_id, status'],
    -- The movement history read, which is ORDER BY moved_at DESC.
    ARRAY['idx_stock_movement_item_moved_at', 'stock_movement', 'inventory_item_id, moved_at DESC'],
    -- accumulatedPosted (asset.repo.js:63).
    ARRAY['idx_depreciation_schedule_asset_posted', 'depreciation_schedule', 'asset_id, posted'],
    -- getPeriodForDate — runs on EVERY ledger post and had no index at all.
    ARRAY['idx_accounting_period_entity_dates', 'accounting_period', 'entity_id, starts_on, ends_on']
  ];
  cols    text[];
  c       text;
  ok      boolean;
  made    int := 0;
  skipped int := 0;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    -- Split the column list and check each one; `moved_at DESC` carries a
    -- direction, so strip it before looking the column up.
    cols := string_to_array(spec[3], ', ');
    ok := true;
    FOREACH c IN ARRAY cols LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name   = spec[2]
           AND column_name  = split_part(trim(c), ' ', 1)
      ) THEN
        ok := false;
      END IF;
    END LOOP;

    IF NOT ok THEN
      skipped := skipped + 1;
      RAISE WARNING '[0504] %: %(%) — column absent, index skipped (DATA 3.3 drift)',
        current_schema(), spec[2], spec[3];
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = current_schema() AND indexname = spec[1]
    ) THEN
      EXECUTE format('CREATE INDEX %I ON %I.%I (%s)', spec[1], current_schema(), spec[2], spec[3]);
      made := made + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[0504] %: % correctness index(es) created, % skipped.',
    current_schema(), made, skipped;
END $$;

-- ── Part 2: trigram indexes for ILIKE search (PERF S16) ─────────────────────

-- The migrator runs this file once per schema with search_path set to
-- `<schema>,public`. A bare CREATE EXTENSION therefore installs pg_trgm into
-- whichever schema came first on the LIVE pass — and an extension is
-- database-wide, so the SANDBOX pass finds `IF NOT EXISTS` already satisfied
-- while `gin_trgm_ops` sits in a schema that is not on ITS search_path:
--
--     operator class "gin_trgm_ops" does not exist for access method "gin"
--
-- Ask for `public` explicitly, and below, resolve where the extension actually
-- lives and schema-qualify the operator class — which is correct whether this
-- tenant got the extension from this file or already had it somewhere else.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

DO $$
DECLARE
  pair   text[];
  pairs  text[][] := ARRAY[
    -- Declared via makeRepo({ searchColumn }) — these are certain.
    ARRAY['capability',          'name'],
    ARRAY['field_visibility',    'field_key'],
    ARRAY['inventory_item',      'sku'],
    ARRAY['scope',               'name'],
    ARRAY['service_type',        'name_fr'],
    ARRAY['training',            'title'],
    ARRAY['vacancy',             'title'],
    ARRAY['wms_equipment',       'label'],
    -- Hand-rolled `col ILIKE` in module repos.
    ARRAY['app_user',            'email'],
    ARRAY['app_user',            'full_name'],
    ARRAY['chart_of_accounts',   'code'],
    ARRAY['chart_of_accounts',   'label_fr'],
    ARRAY['client_master',       'name'],
    ARRAY['comms_message',       'body'],
    ARRAY['corporate_entity',    'code'],
    ARRAY['corporate_entity',    'legal_name'],
    ARRAY['costing_line',        'bl_mawb'],
    ARRAY['costing_line',        'vessel_flight'],
    ARRAY['dictionary_item',     'code'],
    ARRAY['dictionary_item',     'label_en'],
    ARRAY['dictionary_item',     'label_fr'],
    ARRAY['employee',            'cnps_number'],
    ARRAY['employee',            'full_name'],
    ARRAY['employee',            'job_title'],
    ARRAY['geo_place',           'name'],
    ARRAY['geo_place',           'query_key'],
    ARRAY['invoice',             'doc_number'],
    ARRAY['journal_entry',       'source'],
    ARRAY['journal_entry',       'source_doc_ref'],
    ARRAY['lead',                'company_name'],
    ARRAY['lead',                'contact_name'],
    ARRAY['milestone_template',  'key'],
    ARRAY['milestone_template',  'name_en'],
    ARRAY['milestone_template',  'name_fr'],
    ARRAY['opportunity',         'name'],
    ARRAY['sop_document',        'title'],
    ARRAY['succession_plan',     'role_title'],
    ARRAY['supplier_master',     'name'],
    ARRAY['talent_pool',         'full_name'],
    ARRAY['talent_pool',         'skills'],
    ARRAY['vehicle',             'registration']
  ];
  tbl      text;
  col      text;
  idx      text;
  ext_ns   text;
  made     int := 0;
  skipped  int := 0;
BEGIN
  -- Where does pg_trgm actually live on this database?
  SELECT n.nspname INTO ext_ns
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_trgm';

  IF ext_ns IS NULL THEN
    RAISE WARNING '[0504] %: pg_trgm is not installed — trigram search indexes skipped. Free-text search stays a sequential scan (PERF S16).', current_schema();
    RETURN;
  END IF;
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    tbl := pair[1];
    col := pair[2];

    -- Resolve against THIS schema (search_path is set per schema by the
    -- migrator), and only for text-ish columns — gin_trgm_ops is undefined on
    -- anything else and would abort the whole migration.
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns c
       WHERE c.table_schema = current_schema()
         AND c.table_name   = tbl
         AND c.column_name  = col
         AND c.data_type IN ('text', 'character varying', 'character')
    ) THEN
      skipped := skipped + 1;
      RAISE NOTICE '[0504] skipped %.% — no such text column in %', tbl, col, current_schema();
      CONTINUE;
    END IF;

    idx := format('idx_trgm_%s_%s', tbl, col);
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = current_schema() AND indexname = idx
    ) THEN
      EXECUTE format(
        'CREATE INDEX %I ON %I.%I USING gin (%I %I.gin_trgm_ops)',
        idx, current_schema(), tbl, col, ext_ns
      );
      made := made + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[0504] trigram indexes: % created, % skipped, in schema %',
    made, skipped, current_schema();
END $$;

-- DOWN
-- Indexes only; no data is touched.
-- DROP INDEX IF EXISTS idx_invoice_status_type;
-- DROP INDEX IF EXISTS idx_payment_allocation_invoice_id;
-- DROP INDEX IF EXISTS idx_journal_line_account_entry;
-- DROP INDEX IF EXISTS idx_journal_entry_entity_period_status;
-- DROP INDEX IF EXISTS idx_stock_movement_item_moved_at;
-- DROP INDEX IF EXISTS idx_depreciation_schedule_asset_posted;
-- DROP INDEX IF EXISTS idx_accounting_period_entity_dates;
-- -- and each idx_trgm_<table>_<column> created by the second DO block:
-- DO $$ DECLARE i record; BEGIN
--   FOR i IN SELECT indexname FROM pg_indexes
--             WHERE schemaname = current_schema() AND indexname LIKE 'idx_trgm_%' LOOP
--     EXECUTE format('DROP INDEX IF EXISTS %I', i.indexname);
--   END LOOP; END $$;
-- -- pg_trgm is left installed: other things may use it, and DROP EXTENSION
-- -- would cascade to their indexes too.
