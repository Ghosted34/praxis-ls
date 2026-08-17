-- ============================================================================
-- TENANT DB — 0704 rules you can actually add, a query raised while it still
-- matters, and an SOP with a document in it
--
-- ── 1. THE REWARD RULES DO NOT EXIST ───────────────────────────────────────
--
-- 0697 built `hr_rule` with four kinds — LATENESS, ABSENCE, REWARD, CONDUCT —
-- and seeded TWO: a lateness deduction and an unexcused absence. The UI has
-- tones and labels for all four. Nothing ever created a REWARD or a CONDUCT
-- rule, and the rules screen has no "new rule" affordance at all, so the two
-- halves of the system nobody could reach were the two that pay people rather
-- than charge them.
--
-- That asymmetry is worth naming: a house-rules engine that ships with two ways
-- to dock somebody's pay and no way to recognise good work is not a neutral
-- omission. The endpoint to create one has existed since 0697
-- (POST /sops/rules); this seeds the shapes so the first thing an HR manager
-- sees is an editable example rather than an empty form, and INACTIVE for the
-- same reason 0697's were — nothing starts moving money because a migration ran.
--
-- ── 2. A QUERY THAT ARRIVES THE NEXT MORNING IS NOT A QUERY ────────────────
--
-- `auto_query` works, but it fires from the RECONCILER, which runs over
-- completed days. So somebody who walks in ninety minutes late on Tuesday is
-- asked about it on Wednesday — by which time the honest answer ("the ferry was
-- cancelled") has to be recalled rather than simply given, and the manager who
-- watched them arrive has moved on.
--
-- Raising it at the punch is the fix, and it creates exactly one new problem:
-- at clock-in there is no `attendance_day` row yet, so there is nowhere to put
-- `hr_query_id`, and the reconciler — which checks `NOT row.hr_query_id` before
-- raising — would raise a SECOND query that night for the same morning.
--
-- Hence the provenance columns below. `work_date` + `hr_rule_id` + `source`
-- let the reconciler FIND the query the punch already raised and adopt it. The
-- partial unique index makes that structural rather than a convention: two
-- auto-raised queries for the same person, day and rule are refused by the
-- database, so the duplicate cannot come back through a path nobody thought of.
--
-- ── 3. AN SOP IS A TITLE AND A FILE SOMEBODY REMEMBERED TO UPLOAD ──────────
--
--   sop_document(title, category, vault_id, version_no, is_active)
--
-- There is no document in it. `vault_id` is a PDF a human made elsewhere and
-- attached, so an SOP nobody has written yet is a row with a title and nothing
-- behind it — and `hr_rule.sop_document_id` points at it to answer "which page
-- says I can be charged for this?", which that row cannot answer.
--
-- The columns below give it a body, the scope it applies to (a department, an
-- operation, or the whole company), and somewhere to put the PDF the system
-- renders from that body. Same split as 0700's contracts: the model writes the
-- PROSE, the tenant's own facts are passed in and echoed, and the rendered file
-- is a reference rather than the source of truth.
-- ============================================================================

-- ── 1. The rules nobody could reach ────────────────────────────────────────

--
-- The REWARD rows carry metric/comparator/threshold, not just an effect. 0697
-- defined a reward as something MEASURED over a month — a bonus with no metric
-- is a payment somebody authorises by hand, which is not what this table is
-- for, and it would sit in the list looking configured while computing nothing.
INSERT INTO hr_rule (code, name, description, kind, metric, comparator, threshold,
                     tiers, effect, effect_value,
                     auto_query, query_severity, is_active, is_system)
VALUES
  ('REWARD_PERFECT_ATTENDANCE', 'Perfect attendance bonus',
   'A full month with no unexcused absence and no lateness beyond the grace window.',
   'REWARD', 'late_days', 'lte', 0,
   '[]'::jsonb, 'BONUS_FIXED', 10000, false, 'INFO', false, false),
  ('REWARD_PUNCTUALITY', 'Punctuality bonus',
   'Measured on the same punctuality figure the appraisal cycle computes (0701), so staff are paid on the number they are appraised on rather than a second one that disagrees with it.',
   'REWARD', 'punctuality_pct', 'gte', 95,
   '[]'::jsonb, 'BONUS_PCT_SALARY', 2, false, 'INFO', false, false),
  ('CONDUCT_QUERY', 'Conduct query',
   'Raises a query for the employee to answer. Costs nothing on its own — a sanction is a separate decision, and one a person takes.',
   'CONDUCT', NULL, NULL, NULL,
   '[]'::jsonb, 'QUERY_ONLY', NULL, true, 'SERIOUS', false, false)
-- DO NOTHING, never DO UPDATE: a tenant who has edited the bonus figure to
-- their own must not have it reset to 10,000 by a replay.
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN hr_rule.kind IS
  'LATENESS and ABSENCE charge; REWARD pays; CONDUCT asks. All four are creatable from the rules screen — 0697 seeded only the two that charge, which left a house-rules engine with two ways to dock pay and no way to recognise good work.';

-- ── 2. Where a query came from ─────────────────────────────────────────────

ALTER TABLE hr_query
  -- The day being asked about, as a DATE in the workplace's own calendar. Not
  -- derived from created_at: a query raised at 00:20 on a night shift is about
  -- the previous working day, and the reconciler matches on this.
  ADD COLUMN IF NOT EXISTS work_date  date,
  ADD COLUMN IF NOT EXISTS hr_rule_id uuid REFERENCES hr_rule(hr_rule_id) ON DELETE SET NULL,
  -- The punch that triggered it, when there was one. Lets the employee's answer
  -- sit beside the evidence rather than beside a date.
  ADD COLUMN IF NOT EXISTS attendance_id uuid REFERENCES attendance_log(attendance_id) ON DELETE SET NULL,
  -- CLOCK_IN = raised at the punch, while the morning is still the morning.
  -- RECONCILE = raised by the nightly settlement (the pre-0704 behaviour, and
  -- still correct for an absence, which has no punch to hang off).
  -- MANUAL = a human wrote it. The default, because every query that existed
  -- before this migration was written by a person.
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL',
  -- What it was at the moment of the punch. The reconciler recomputes the
  -- settled figure; keeping the original means an employee can see they were
  -- asked about 90 minutes and charged for 90 minutes, or ask why not.
  ADD COLUMN IF NOT EXISTS minutes_late integer;

DO $$ BEGIN
  ALTER TABLE hr_query ADD CONSTRAINT ck_hr_query_source
    CHECK (source IN ('MANUAL','CLOCK_IN','RECONCILE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ONE auto-raised query per person, per day, per rule.
--
-- This is what makes "the reconciler adopts the punch's query" structural
-- rather than a convention two functions happen to share. Without it, any path
-- that raises before `attendance_day` exists — the punch today, a mobile
-- offline sync tomorrow — silently doubles up, and the employee is asked twice
-- about one late morning. MANUAL is excluded: a manager may legitimately write
-- two queries about the same day.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_query_auto_day
  ON hr_query (employee_id, work_date, hr_rule_id)
  WHERE source <> 'MANUAL' AND work_date IS NOT NULL AND hr_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_hr_query_work_date
  ON hr_query (work_date) WHERE work_date IS NOT NULL;

COMMENT ON COLUMN hr_query.source IS
  'CLOCK_IN = raised at the punch, while the employee can still answer from memory. RECONCILE = raised by the nightly settlement. MANUAL = written by a person, and the default, because every query predating 0704 was.';
COMMENT ON INDEX ux_hr_query_auto_day IS
  'Stops one late morning producing two queries. The punch raises it and the reconciler adopts it; this makes that structural rather than something two functions have to remember.';

-- ── 3. An SOP with a document in it ────────────────────────────────────────

ALTER TABLE sop_document
  -- What the procedure SAYS. The source of truth; the PDF is rendered from it.
  ADD COLUMN IF NOT EXISTS body_md text,
  ADD COLUMN IF NOT EXISTS summary text,
  -- Who it binds. COMPANY = everybody, DEPARTMENT = one department's staff,
  -- OPERATIONS = a working practice that follows the WORK rather than the org
  -- chart (loading a container, clearing customs) and so applies to whoever is
  -- doing it that week. That third case is the one a department-only model
  -- cannot express, and it is most of what a logistics company's procedures
  -- actually are.
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS owner_role text,
  -- When it starts binding, and when somebody must look at it again. A
  -- procedure nobody has reviewed in four years is a liability that reads as
  -- policy.
  ADD COLUMN IF NOT EXISTS effective_on date,
  ADD COLUMN IF NOT EXISTS review_on    date,
  -- Who wrote it. The same honesty 0700 requires of a contract: nobody should
  -- issue a procedure believing a model reviewed it when it fell back to a
  -- template, or the reverse.
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_model     text,
  ADD COLUMN IF NOT EXISTS ai_drafted_at timestamptz,
  -- The rendered file. SEPARATE from `vault_id`, which is the scan somebody
  -- uploaded — a tenant may have both, and overwriting an uploaded original
  -- with a generated one would destroy the signed copy.
  ADD COLUMN IF NOT EXISTS pdf_vault_id uuid REFERENCES document_vault(doc_id),
  ADD COLUMN IF NOT EXISTS pdf_rendered_at timestamptz;

DO $$ BEGIN
  ALTER TABLE sop_document ADD CONSTRAINT ck_sop_scope
    CHECK (scope IN ('COMPANY','DEPARTMENT','OPERATIONS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_sop_document_scope
  ON sop_document(scope, department) WHERE is_active;
CREATE INDEX IF NOT EXISTS ix_sop_document_review
  ON sop_document(review_on) WHERE review_on IS NOT NULL AND is_active;

COMMENT ON COLUMN sop_document.body_md IS
  'What the procedure says. The SOURCE OF TRUTH — pdf_vault_id is rendered from it, and vault_id remains whatever a human uploaded.';
COMMENT ON COLUMN sop_document.scope IS
  'OPERATIONS is the case a department-only model cannot express: a practice that follows the WORK rather than the org chart, and so binds whoever is doing it this week.';
COMMENT ON COLUMN sop_document.pdf_vault_id IS
  'The PDF rendered from body_md. Deliberately NOT vault_id — that is the copy somebody uploaded, and a tenant may hold a signed original alongside the generated one.';

-- DOWN
-- ALTER TABLE sop_document
--   DROP COLUMN IF EXISTS pdf_rendered_at, DROP COLUMN IF EXISTS pdf_vault_id,
--   DROP COLUMN IF EXISTS ai_drafted_at, DROP COLUMN IF EXISTS ai_model,
--   DROP COLUMN IF EXISTS ai_generated, DROP COLUMN IF EXISTS review_on,
--   DROP COLUMN IF EXISTS effective_on, DROP COLUMN IF EXISTS owner_role,
--   DROP COLUMN IF EXISTS department, DROP COLUMN IF EXISTS scope,
--   DROP COLUMN IF EXISTS summary, DROP COLUMN IF EXISTS body_md;
-- DROP INDEX IF EXISTS ux_hr_query_auto_day;
-- ALTER TABLE hr_query
--   DROP COLUMN IF EXISTS minutes_late, DROP COLUMN IF EXISTS source,
--   DROP COLUMN IF EXISTS attendance_id, DROP COLUMN IF EXISTS hr_rule_id,
--   DROP COLUMN IF EXISTS work_date;
--
-- DESTRUCTIVE in two ways.
--
-- (a) Dropping sop_document.body_md discards the TEXT of every procedure
--     written through this feature. A rendered PDF survives in the vault, so
--     the document is not lost — but it becomes uneditable, and the next
--     version has to be retyped from the PDF. Export body_md first.
-- (b) Dropping hr_query.work_date/source re-opens the duplicate this migration
--     closes: the reconciler can no longer tell which queries the punch already
--     raised, and the night after the rollback every late morning is queried a
--     second time.
--
-- The seeded rules are left in place by this DOWN on purpose: they are INACTIVE
-- and harmless, and a tenant may have edited them into their real ones.
