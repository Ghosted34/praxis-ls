-- ============================================================================
-- TENANT DB — 14250 Real people in TEST. Live employees, and the companies they
-- belong to, are copied ONE WAY into the sandbox. Nothing travels back.
--
-- Owner decision, 29 Sep 2026: "the sandbox shows real employees, but the live
-- never shows sandbox. I create a new employee and provision an account, the
-- sandbox shows that employee everywhere — but employees created on sandbox
-- never make it to live." And, asked what a TEST edit to a real person does:
-- "allow, live wins" — the TEST edit stands until that person is next changed
-- in LIVE, and then LIVE's version replaces the copy.
--
-- ── WHY A COPY, AND NOT "READ LIVE FROM TEST" ──────────────────────────────
--
-- 28 columns across payroll, leave, attendance, contracts, dispatch and more
-- are `REFERENCES employee(employee_id)`, and in the sandbox schema they point at
-- `sandbox.employee` (check-schema-parity.js forbids a sandbox FK that reaches
-- into live). A person who is only DISPLAYED in TEST could not be given a leave
-- request or put through a payroll run there. The row has to physically exist
-- in the sandbox, under the same id, so every FK and every join finds it.
--
-- ── WHY A TRIGGER, AND NOT A CALL IN employees.service ─────────────────────
--
-- About 25 modules write employee rows — the HR form, the vacancy hire, driver
-- records, self-service, onboarding, lifecycle status changes, imports, the AI.
-- A copy made from the service would be one more thing each of them has to
-- remember. A trigger on the live table sees every write, whoever made it.
--
-- ── ONE WAY, BY CONSTRUCTION ───────────────────────────────────────────────
--
-- The migration set builds both schemas, so the trigger exists on the sandbox
-- tables too — and there its first line returns. Only a write to a LIVE table
-- copies anything, and the only schema it writes to is `sandbox`. No code path
-- here reads the sandbox and writes the live schema.
--
-- ── A SANDBOX PROBLEM NEVER FAILS A LIVE WRITE ─────────────────────────────
--
-- The copy runs in its own sub-transaction and swallows any error into a
-- WARNING. A missing sandbox (mid-wipe), a clash with a TEST-made row, a lock
-- held by someone editing the copy in TEST: the live hire still commits, and
-- the copy is retried by the next change or the next deploy's backfill.
-- `lock_timeout` bounds the wait, so a sandbox wipe holding its schema lock
-- delays a live HR save by two seconds at most, never by the whole rebuild.
--
-- ── FOREIGN KEYS THE SANDBOX CANNOT SATISFY ARE CLEARED, NOT FAILED ────────
--
-- A live company's remittance account or cover image may not exist in the
-- sandbox. Rather than lose the whole row, the copier nulls any single-column
-- foreign key whose target is not there. Seeded reference data (tax
-- jurisdictions and the like) carries the same ids in both schemas, so those
-- links survive. A manager copied after their report is wired up by the
-- backfill's second pass.
--
-- ── A TEST RECORD NEVER BLOCKS A REAL ONE ──────────────────────────────────
--
-- A matricule and a company code are unique. A sandbox that was used before
-- this migration holds TEST hires numbered from the same series as the real
-- staff (both schemas started at SLAS-001), so a real person's copy would
-- collide with a TEST person. Live wins here too: the TEST-made row gives the
-- value up and keeps it with a "-T" suffix — the same suffix
-- employees.repo.allocateStaffNo now puts on every number it allocates in TEST,
-- so the two series cannot meet again.
--
-- ── WHAT IS NOT COPIED ─────────────────────────────────────────────────────
--
-- The PERSON is copied, not their history. Contracts, payslips, leave taken,
-- documents and allowances stay in live; TEST starts each real person with a
-- clean file to experiment on.
-- ============================================================================

ALTER TABLE employee ADD COLUMN IF NOT EXISTS copied_from_live_at timestamptz;

COMMENT ON COLUMN employee.copied_from_live_at IS
  'Sandbox only: when this row was last copied from the live employee with the same id (14250). NULL in live, and NULL on a person created in TEST. The next live change to the person overwrites the copy.';

-- ── 1. The copier ───────────────────────────────────────────────────────────
-- Upsert one live row (as jsonb) into the sandbox copy of `p_table`, keyed on
-- `p_pk`. `p_overwrite` = true replaces an existing copy (a live change: live
-- wins); false only fills a gap (the backfill: a TEST edit is left standing).
-- Returns whether a row was written.
--
-- Columns are matched by NAME, and only those present on both sides are copied,
-- so a column order that differs between the schemas, or a migration that has
-- reached one schema and not yet the other, cannot misplace a value.
CREATE OR REPLACE FUNCTION sandbox_copy_from_live(
  p_table text, p_pk text, p_row jsonb, p_overwrite boolean
) RETURNS boolean
LANGUAGE plpgsql
AS $fn$
DECLARE
  target   regclass := to_regclass(format('sandbox.%I', p_table));
  fk       record;
  present  boolean;
  cols     text;
  excluded text;
  written  integer;
BEGIN
  IF target IS NULL OR p_row IS NULL THEN
    RETURN false;
  END IF;

  -- Clear what the sandbox cannot point at (see the header).
  FOR fk IN
    SELECT a.attname::text AS col, rn.nspname AS ref_schema, rt.relname AS ref_table,
           ra.attname AS ref_col, format_type(ra.atttypid, ra.atttypmod) AS ref_type
      FROM pg_constraint c
      JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_class rt     ON rt.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = rt.relnamespace
      JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
     WHERE c.conrelid = target AND c.contype = 'f' AND cardinality(c.conkey) = 1
  LOOP
    CONTINUE WHEN p_row ->> fk.col IS NULL;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1::%s)',
                   fk.ref_schema, fk.ref_table, fk.ref_col, fk.ref_type)
       INTO present USING p_row ->> fk.col;
    IF NOT present THEN
      p_row := jsonb_set(p_row, ARRAY[fk.col], 'null'::jsonb);
    END IF;
  END LOOP;

  SELECT string_agg(quote_ident(s.attname), ', ' ORDER BY s.attnum),
         string_agg('EXCLUDED.' || quote_ident(s.attname), ', ' ORDER BY s.attnum)
    INTO cols, excluded
    FROM pg_attribute s
   WHERE s.attrelid = target AND s.attnum > 0 AND NOT s.attisdropped
     AND s.attgenerated = '' AND s.attidentity <> 'a'
     AND p_row ? s.attname::text;

  EXECUTE format(
    'INSERT INTO sandbox.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::sandbox.%1$I, $1) '
    || 'ON CONFLICT (%3$I) DO '
    || CASE WHEN p_overwrite THEN 'UPDATE SET (%2$s) = ROW(%4$s)' ELSE 'NOTHING' END,
    p_table, cols, p_pk, excluded
  ) USING p_row;
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written > 0;
END
$fn$;

-- ── 2. The trigger: every live write, copied ────────────────────────────────
-- TG_ARGV[0] is the primary-key column. `employee` and `corporate_entity` both
-- key on a uuid.
CREATE OR REPLACE FUNCTION sandbox_follow_live() RETURNS trigger
LANGUAGE plpgsql
SET lock_timeout = '2s'
AS $fn$
DECLARE
  pk     text := TG_ARGV[0];
  rec    jsonb;
  entity uuid;
BEGIN
  -- One way. This same trigger is on the sandbox tables, and there it stops.
  IF TG_TABLE_SCHEMA <> 'live' THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      -- Live only hard-deletes a record nothing references. The copy may be
      -- referenced by TEST data, and then it is deactivated instead — the same
      -- outcome live's own delete picks for a referenced person.
      BEGIN
        -- DESTRUCTIVE: removes only the SANDBOX copy of a row live has just deleted, at runtime; running this migration deletes nothing
        EXECUTE format('DELETE FROM sandbox.%I WHERE %I = $1::uuid', TG_TABLE_NAME, pk)
          USING to_jsonb(OLD) ->> pk;
      EXCEPTION WHEN foreign_key_violation THEN
        EXECUTE format('UPDATE sandbox.%I SET is_active = false WHERE %I = $1::uuid', TG_TABLE_NAME, pk)
          USING to_jsonb(OLD) ->> pk;
      END;
      RETURN NULL;
    END IF;

    rec := to_jsonb(NEW);

    IF TG_TABLE_NAME = 'employee' THEN
      -- Their company first, or the copier would clear entity_id. Gap-fill
      -- only: the company's own trigger keeps an existing copy current.
      entity := (rec ->> 'entity_id')::uuid;
      IF entity IS NOT NULL THEN
        PERFORM live.sandbox_copy_from_live(
          'corporate_entity', 'entity_id',
          (SELECT to_jsonb(c) FROM live.corporate_entity c WHERE c.entity_id = entity),
          false);
      END IF;

      -- A TEST-made person holding this real person's matricule gives it up
      -- (live wins) and keeps it with the "-T" that marks a TEST number.
      UPDATE sandbox.employee
         SET staff_no = staff_no || '-T'
       WHERE staff_no = rec ->> 'staff_no'
         AND employee_id <> (rec ->> 'employee_id')::uuid
         AND copied_from_live_at IS NULL;

      PERFORM live.sandbox_copy_from_live(
        'employee', 'employee_id',
        rec || jsonb_build_object('copied_from_live_at', now()),
        true);

      -- The account provisioned for this person, linked in TEST as in LIVE, so
      -- "My profile" and self-service find them there too.
      UPDATE sandbox.app_user s
         SET employee_id = l.employee_id
        FROM live.app_user l
       WHERE l.user_id = s.user_id
         AND l.employee_id = (rec ->> 'employee_id')::uuid
         AND s.employee_id IS DISTINCT FROM l.employee_id;
    ELSE
      -- The same for a company code: a TEST-made company never blocks a real one.
      IF TG_TABLE_NAME = 'corporate_entity' THEN
        UPDATE sandbox.corporate_entity s
           SET code = s.code || '-T'
         WHERE s.code = rec ->> 'code'
           AND s.entity_id <> (rec ->> 'entity_id')::uuid
           AND NOT EXISTS (SELECT 1 FROM live.corporate_entity l WHERE l.entity_id = s.entity_id);
      END IF;
      PERFORM live.sandbox_copy_from_live(TG_TABLE_NAME, pk, rec, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sandbox copy of live.% % skipped: % (SQLSTATE %)',
      TG_TABLE_NAME, COALESCE(to_jsonb(NEW) ->> pk, to_jsonb(OLD) ->> pk), SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE TRIGGER trg_entity_follow_live
  AFTER INSERT OR UPDATE OR DELETE ON corporate_entity
  FOR EACH ROW EXECUTE FUNCTION sandbox_follow_live('entity_id');

CREATE OR REPLACE TRIGGER trg_employee_follow_live
  AFTER INSERT OR UPDATE OR DELETE ON employee
  FOR EACH ROW EXECUTE FUNCTION sandbox_follow_live('employee_id');

-- ── 3. The backfill: everything live already holds ─────────────────────────
-- For a sandbox that has just been rebuilt (the 14-day wipe drops it), and for
-- people who existed before this migration. Gap-fill only — it never replaces
-- a copy, so a TEST edit survives a deploy and yields only to a live change.
-- Run by src/shared/db/sandbox-live-copy.js after every wipe and every deploy.
CREATE OR REPLACE FUNCTION sandbox_backfill_from_live(
  OUT entities integer, OUT employees integer, OUT accounts integer
)
LANGUAGE plpgsql
AS $fn$
DECLARE
  r record;
BEGIN
  entities := 0; employees := 0; accounts := 0;
  IF to_regclass('sandbox.employee') IS NULL OR to_regclass('sandbox.corporate_entity') IS NULL THEN
    RETURN;
  END IF;

  -- TEST-made rows holding a real company's code or a real person's matricule
  -- give it up first (live wins; the "-T" suffix marks a TEST value). A copy of
  -- a DIFFERENT live row is left alone — that is live renumbering itself, and
  -- the next change to either row settles it.
  --
  -- Every step below traps its own error, because this runs inside the sandbox
  -- wipe's transaction: a failure here must cost some copies, not the rebuild.
  BEGIN
    UPDATE sandbox.corporate_entity s
       SET code = s.code || '-T'
      FROM live.corporate_entity l
     WHERE s.code = l.code AND s.entity_id <> l.entity_id
       AND NOT EXISTS (SELECT 1 FROM live.corporate_entity x WHERE x.entity_id = s.entity_id);

    UPDATE sandbox.employee s
       SET staff_no = s.staff_no || '-T'
      FROM live.employee l
     WHERE s.staff_no = l.staff_no AND s.employee_id <> l.employee_id
       AND s.copied_from_live_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sandbox backfill: freeing real codes/matricules failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;

  -- Groups before their subsidiaries, so parent_entity_id resolves.
  FOR r IN
    SELECT to_jsonb(c) AS j FROM live.corporate_entity c
     ORDER BY (c.parent_entity_id IS NOT NULL), c.created_at
  LOOP
    BEGIN
      IF live.sandbox_copy_from_live('corporate_entity', 'entity_id', r.j, false) THEN
        entities := entities + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sandbox backfill: company % skipped: % (SQLSTATE %)', r.j ->> 'entity_id', SQLERRM, SQLSTATE;
    END;
  END LOOP;

  FOR r IN
    SELECT to_jsonb(e) || jsonb_build_object('copied_from_live_at', now()) AS j
      FROM live.employee e
     ORDER BY e.created_at
  LOOP
    BEGIN
      IF live.sandbox_copy_from_live('employee', 'employee_id', r.j, false) THEN
        employees := employees + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sandbox backfill: employee % skipped: % (SQLSTATE %)', r.j ->> 'employee_id', SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- Second pass: links whose target arrived after the row pointing at it.
  BEGIN
    UPDATE sandbox.corporate_entity s
       SET parent_entity_id = l.parent_entity_id
      FROM live.corporate_entity l
     WHERE s.entity_id = l.entity_id
       AND s.parent_entity_id IS NULL AND l.parent_entity_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM sandbox.corporate_entity p WHERE p.entity_id = l.parent_entity_id);

    UPDATE sandbox.employee s
       SET reports_to = l.reports_to
      FROM live.employee l
     WHERE s.employee_id = l.employee_id
       AND s.copied_from_live_at IS NOT NULL
       AND s.reports_to IS NULL AND l.reports_to IS NOT NULL
       AND EXISTS (SELECT 1 FROM sandbox.employee m WHERE m.employee_id = l.reports_to);

    UPDATE sandbox.app_user s
       SET employee_id = l.employee_id
      FROM live.app_user l
     WHERE s.user_id = l.user_id
       AND l.employee_id IS NOT NULL
       AND s.employee_id IS DISTINCT FROM l.employee_id
       AND EXISTS (SELECT 1 FROM sandbox.employee e WHERE e.employee_id = l.employee_id);
    GET DIAGNOSTICS accounts = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sandbox backfill: relinking managers/accounts failed: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
END
$fn$;

-- ============================================================================
-- VERIFY (as the tenant role, search_path live)
--   INSERT INTO employee (full_name) VALUES ('Mirror probe') RETURNING employee_id;
--   SELECT copied_from_live_at FROM sandbox.employee WHERE employee_id = '<id>';  -- a timestamp
--   INSERT INTO sandbox.employee (full_name) VALUES ('TEST only') RETURNING employee_id;
--   SELECT count(*) FROM live.employee WHERE employee_id = '<that id>';           -- 0, always
--   SELECT * FROM live.sandbox_backfill_from_live();
--
-- DOWN
--   -- Copies already made stay in the sandbox until its next wipe; that is harmless.
--   -- DROP TRIGGER IF EXISTS trg_employee_follow_live ON employee;
--   -- DROP TRIGGER IF EXISTS trg_entity_follow_live ON corporate_entity;
--   -- DROP FUNCTION IF EXISTS sandbox_backfill_from_live();
--   -- DROP FUNCTION IF EXISTS sandbox_follow_live();
--   -- DROP FUNCTION IF EXISTS sandbox_copy_from_live(text, text, jsonb, boolean);
--   -- ALTER TABLE employee DROP COLUMN IF EXISTS copied_from_live_at;
-- ============================================================================
