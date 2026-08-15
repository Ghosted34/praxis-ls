-- ============================================================================
-- TENANT DB — 0683 the things a candidate asks before they apply
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- A vacancy could say what the role was, roughly where, and what it paid. It
-- could not say whether the job is on-site, what the hours are, how many days a
-- week are in the office, whether there is a probation period, when it starts,
-- or that the band is confidential. Those are not decoration — they are the
-- questions that decide whether somebody applies at all, and every one of them
-- was being smuggled into free text (`location` held "Douala · On-site") or
-- asked in the interview and then dropped on the floor.
--
-- ── WORK_MODE GETS ITS OWN COLUMN NOW ──────────────────────────────────────
--
-- 0526 deliberately folded it into the location line, arguing a migration for a
-- three-value label was not worth it. That was right while nothing read it.
-- The editor now has a control for it and the careers page shows it as its own
-- field, so a substring of a display string is the wrong home: "On-site" cannot
-- be filtered, translated or changed without rewriting the sentence around it.
--
-- ── CITY / STATE / COUNTRY ALONGSIDE, NOT INSTEAD ──────────────────────────
--
-- `location` stays, because the drafting model writes a human line and a
-- candidate reads one. The three parts are the structured truth for filtering
-- and for the careers page's own layout, and the public read composes them when
-- `location` is blank rather than making somebody type the address twice.
--
-- ── SALARY_HIDDEN IS ENFORCED, NOT ADVISORY ────────────────────────────────
--
-- The band stays on the row — payroll planning needs it and the AI needs it to
-- judge a candidate's expectation — but `careers.publicVacancy` drops both
-- bounds when this is set. A "hidden" flag the public JSON ignores would be
-- worse than no flag: it reads as a promise.
--
-- ── APPLY_CONFIG ───────────────────────────────────────────────────────────
--
-- What the application form insists on: `{ require_cover_letter, require_
-- portfolio }`. jsonb rather than two booleans because this list grows with the
-- form, and the public apply path enforces it — an unenforced toggle is a lie
-- told to the recruiter who set it.
-- ============================================================================

ALTER TABLE vacancy
  ADD COLUMN IF NOT EXISTS work_mode         text,
  ADD COLUMN IF NOT EXISTS working_hours     text,
  ADD COLUMN IF NOT EXISTS days_on_site      smallint,
  ADD COLUMN IF NOT EXISTS days_off_site     smallint,
  ADD COLUMN IF NOT EXISTS days_off          smallint,
  ADD COLUMN IF NOT EXISTS probation_months  smallint,
  ADD COLUMN IF NOT EXISTS location_city     text,
  ADD COLUMN IF NOT EXISTS location_state    text,
  ADD COLUMN IF NOT EXISTS location_country  text,
  ADD COLUMN IF NOT EXISTS target_start_date date,
  ADD COLUMN IF NOT EXISTS salary_hidden     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apply_config      jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Bounded here as well as in the validator: a week has seven days and a
-- probation nobody would sign is not a typo worth storing. The validator gives
-- the recruiter a named field error; this stops anything else writing nonsense.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_vacancy_week_days') THEN
    ALTER TABLE vacancy ADD CONSTRAINT ck_vacancy_week_days CHECK (
      (days_on_site  IS NULL OR days_on_site  BETWEEN 0 AND 7) AND
      (days_off_site IS NULL OR days_off_site BETWEEN 0 AND 7) AND
      (days_off      IS NULL OR days_off      BETWEEN 0 AND 7) AND
      (probation_months IS NULL OR probation_months BETWEEN 0 AND 24)
    );
  END IF;
END $$;

-- Deliberately NOT a CHECK on work_mode: the drafting model returns free text
-- and a constraint would turn an unexpected label into a 500 at the end of a
-- four-minute interview. The editor offers the three values; anything else is
-- displayed as written.
COMMENT ON COLUMN vacancy.work_mode IS
  'On-site | Hybrid | Remote, as the advert states it. Free text on purpose — the drafting model writes it and an unknown label must display, not fail.';
COMMENT ON COLUMN vacancy.salary_hidden IS
  'When true the public careers JSON omits salary_min/max entirely. The band stays on the row for payroll and for AI scoring against a candidate expectation.';
COMMENT ON COLUMN vacancy.apply_config IS
  'What the public application form requires: { require_cover_letter, require_portfolio }. Enforced in careers.service.apply — an unenforced toggle is a lie told to whoever set it.';

CREATE INDEX IF NOT EXISTS ix_vacancy_location_city ON vacancy(location_city) WHERE location_city IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_vacancy_location_city;
-- ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS ck_vacancy_week_days;
-- ALTER TABLE vacancy
--   DROP COLUMN IF EXISTS apply_config,
--   DROP COLUMN IF EXISTS salary_hidden,
--   DROP COLUMN IF EXISTS target_start_date,
--   DROP COLUMN IF EXISTS location_country,
--   DROP COLUMN IF EXISTS location_state,
--   DROP COLUMN IF EXISTS location_city,
--   DROP COLUMN IF EXISTS probation_months,
--   DROP COLUMN IF EXISTS days_off,
--   DROP COLUMN IF EXISTS days_off_site,
--   DROP COLUMN IF EXISTS days_on_site,
--   DROP COLUMN IF EXISTS working_hours,
--   DROP COLUMN IF EXISTS work_mode;
--
-- Additive, so the undo costs nothing that existed before it — but it DOES
-- discard the working pattern, the probation terms and the structured address
-- of every live advert, and un-hides every band somebody marked confidential.
