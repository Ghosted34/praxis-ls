-- ============================================================================
-- TENANT DB — 12746 Weekly lateness query: its own source, its own index.
--
-- WHAT THIS IS FOR
--
-- The clock-in revamp's weekly pattern query (guide §3.4): after a week closes,
-- an employee who was late on one or more EXPECTED WORKING DAYS is asked once
-- about the pattern. One query per person per completed week — not per day.
--
-- WHY THE DAILY INDEX CANNOT CARRY IT
--
-- 0704 added the daily auto-query's identity:
--
--     ux_hr_query_auto_day (employee_id, work_date, hr_rule_id)
--       WHERE source <> 'MANUAL' AND work_date IS NOT NULL AND hr_rule_id IS NOT NULL
--
-- Note the predicate. `'WEEKLY' <> 'MANUAL'` is TRUE, so a weekly row carrying a
-- non-null `hr_rule_id` would land in that index — and its `work_date` is the
-- week END, which is a real date somebody can also be late on. A weekly summary
-- for the week ending Sunday the 16th would then collide with the daily lateness
-- query for Sunday the 16th, and ON CONFLICT would silently OVERWRITE one with
-- the other: the employee would lose the query about the day, or the one about
-- the week, depending on which wrote second.
--
-- So the weekly row carries `hr_rule_id = NULL` deliberately, which drops it out
-- of the daily index (the `hr_rule_id IS NOT NULL` term). That is the collision
-- fixed — and it is also, on its own, NO DEDUPLICATION AT ALL: Postgres treats
-- NULLs as distinct in a unique index, so a thousand runs of the weekly job
-- would insert a thousand identical queries and every ON CONFLICT clause naming
-- the daily index would simply never fire.
--
-- Hence this index. It is what makes "one query per employee per week"
-- structural rather than a promise the job makes to itself, and it is what the
-- weekly upsert's ON CONFLICT names.
-- ============================================================================

-- 'WEEKLY' — raised by the weekly summariser after the week closed, about a
-- PATTERN rather than a morning. The other three are 0704's.
--
-- DROPPED FIRST, then re-added, rather than 0704's
-- `EXCEPTION WHEN duplicate_object THEN NULL` pattern: that one is right for
-- CREATING a constraint that may already be there, and exactly wrong for
-- REPLACING one. 0704's CHECK already exists on every tenant and refuses
-- 'WEEKLY', so a guarded add would swallow its own duplicate_object, leave the
-- three-value constraint standing, and the failure would surface a week later
-- as every weekly insert being rejected by a constraint this file believed it
-- had widened.
--
-- The add is still guarded on pg_constraint so the file is safe to run twice —
-- a migration re-runs more often than people expect (a part-way failure replays
-- the WHOLE file, and CI applies the tenant set twice on purpose). After the
-- drop above the guard is always true on a real run, which is the point: this
-- replaces the definition rather than preserving whichever got there first.
ALTER TABLE hr_query DROP CONSTRAINT IF EXISTS ck_hr_query_source;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hr_query_source') THEN
    ALTER TABLE hr_query ADD CONSTRAINT ck_hr_query_source
      CHECK (source IN ('MANUAL','CLOCK_IN','RECONCILE','WEEKLY'));
  END IF;
END $$;

-- ONE weekly query per person per week. `work_date` holds the week's END date
-- (the Sunday), which is what makes the week identifiable by a single date
-- column without a second one — and what the composer prints in the subject.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_query_weekly_week
  ON hr_query (employee_id, work_date)
  WHERE source = 'WEEKLY' AND work_date IS NOT NULL;

COMMENT ON INDEX ux_hr_query_weekly_week IS
  'One weekly lateness query per employee per completed week, keyed on the week END date. Separate from ux_hr_query_auto_day because the weekly row carries hr_rule_id = NULL (to stay OUT of the daily index, where a week-end date would collide with that day''s own lateness query) — and a NULL in a unique index is distinct from every other NULL, so without this index the weekly job would have no deduplication whatsoever.';

-- DOWN
-- DROP INDEX IF EXISTS ux_hr_query_weekly_week;
-- ALTER TABLE hr_query DROP CONSTRAINT IF EXISTS ck_hr_query_source;
-- ALTER TABLE hr_query ADD CONSTRAINT ck_hr_query_source
--   CHECK (source IN ('MANUAL','CLOCK_IN','RECONCILE'));
