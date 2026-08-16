-- ============================================================================
-- TENANT DB — 0701 appraisals: a cycle, evidence, and a two-sided review
--
-- ── WHAT AN APPRAISAL HAS BEEN ─────────────────────────────────────────────
--
--   kpi_target(employee_id, period_code, metric, target_value, weight)
--   appraisal(kpi_target_id, employee_id, period_code, actual_value, rating,
--             comments, rated_by)
--
-- One row per KPI, rated by a manager, with `rating` optionally derived from
-- `actual_value ÷ target_value`. Three things are missing from that, and each
-- one is the reason a different part of the process cannot happen:
--
--   1. NO CYCLE. `period_code` is a string on each row, so nothing knows that
--      an appraisal round is OPEN, that scoring has closed, or who has not been
--      appraised at all. "Who is still outstanding for H1?" is unanswerable,
--      which is the single question anybody running a review round asks.
--
--   2. NO EVIDENCE. `actual_value` is TYPED BY A HUMAN. The system already
--      knows how punctual somebody was (attendance_day, 0697), what rules they
--      breached, what training they completed and what leave they took — and an
--      appraisal ignores all of it, so the "objective" score is somebody's
--      recollection keyed into a box.
--
--   3. NO EMPLOYEE. There is `rated_by` and nothing else. The employee never
--      sees the appraisal, never acknowledges it and cannot dispute it — so a
--      performance record that may later justify a dismissal has only ever been
--      seen by the person who wrote it.
--
-- ── THE SPLIT THIS FILE ENFORCES: EVIDENCE, SCORE, NARRATIVE ───────────────
--
-- The MODEL writes the narrative. It does not decide the score.
--
-- `ai_rating` is a SUGGESTION derived from operational evidence, kept in its
-- own column beside the human's `rating` — never merged into it. The whole
-- value of showing a manager an evidence-derived number is that they can
-- DISAGREE with it, and a single column that silently becomes one or the other
-- destroys exactly that. `is_calibrated` marks the ones a human has touched, so
-- re-running the scorer never overwrites a judgement somebody made.
--
-- ── WHY THE REVIEW IS ITS OWN TABLE ────────────────────────────────────────
--
-- An `appraisal` row is one KPI. A REVIEW is the conversation about a person
-- over a cycle: an overall figure, a manager's narrative, and the employee's
-- answer to it. Hanging the acknowledgement off one KPI row would mean an
-- employee acknowledging "punctuality" and not the appraisal.
-- ============================================================================

-- ── 1. The cycle ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appraisal_cycle (
  appraisal_cycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       citext UNIQUE NOT NULL,          -- '2026-H1'
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,

  /* DRAFT      — being set up; targets are being written.
   * OPEN       — targets agreed, the period is running.
   * SCORING    — the period is over and managers are scoring.
   * CALIBRATION— scores in, being moderated across teams before release.
   * RELEASED   — employees can see their reviews and acknowledge them. The
   *              state that makes this two-sided; before it, nothing is shown.
   * CLOSED     — finished. Nothing moves. */
  status     text NOT NULL DEFAULT 'DRAFT'
             CHECK (status IN ('DRAFT','OPEN','SCORING','CALIBRATION','RELEASED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_appraisal_cycle_range CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS ix_appraisal_cycle_status ON appraisal_cycle(status);

COMMENT ON COLUMN appraisal_cycle.status IS
  'RELEASED is the state that makes an appraisal two-sided: before it, an employee sees nothing. Nothing is shown to an employee in SCORING or CALIBRATION — a moderated score is not a score yet.';

-- ── 2. Targets belong to a cycle, and some of them score themselves ────────

ALTER TABLE kpi_target ADD COLUMN IF NOT EXISTS appraisal_cycle_id uuid REFERENCES appraisal_cycle(appraisal_cycle_id) ON DELETE SET NULL;

/* Where the actual figure comes from.
 *
 * NULL (the default, and every existing row) = a human types it, exactly as
 * today. The named sources are the ones the system ALREADY has the data for and
 * was ignoring — attendance punctuality since 0697, absence since 0696, rule
 * breaches since 0697, training completion since 0360. Free text rather than an
 * enum so a tenant can name a source the scorer learns later; the scorer skips
 * a source it cannot compute and says so on the row rather than scoring zero. */
ALTER TABLE kpi_target ADD COLUMN IF NOT EXISTS auto_source text;
ALTER TABLE kpi_target ADD COLUMN IF NOT EXISTS scale_max numeric(5,2) NOT NULL DEFAULT 5 CHECK (scale_max > 0);

COMMENT ON COLUMN kpi_target.auto_source IS
  'attendance_punctuality | attendance_absence | rule_breaches | training_completion | kpi_attainment. NULL = scored by hand. A source the scorer cannot compute is left unscored and SAID SO — never scored zero, which would read as failure.';

-- ── 3. What the machine thought, beside what the human thought ─────────────

ALTER TABLE appraisal ADD COLUMN IF NOT EXISTS appraisal_cycle_id uuid REFERENCES appraisal_cycle(appraisal_cycle_id) ON DELETE SET NULL;

/* The evidence-derived suggestion. SEPARATE from `rating`, permanently.
 *
 * The point of showing a manager a number computed from attendance and rule
 * breaches is that they can disagree with it — they know the person was
 * carrying a colleague's workload in March and the data does not. Merging the
 * two into one column destroys the disagreement, which is the only thing that
 * makes either number worth having. */
ALTER TABLE appraisal ADD COLUMN IF NOT EXISTS ai_rating numeric(5,2) CHECK (ai_rating IS NULL OR ai_rating >= 0);
-- What it was computed FROM: { source, present_days, late_days, … }. jsonb
-- because the shape differs per source, and because an employee disputing a
-- score is entitled to the working, not the answer.
ALTER TABLE appraisal ADD COLUMN IF NOT EXISTS ai_evidence jsonb;
ALTER TABLE appraisal ADD COLUMN IF NOT EXISTS ai_scored_at timestamptz;

/* TRUE once a human has set or changed the rating. The scorer never touches a
 * calibrated row — a manager's judgement must survive somebody pressing
 * "re-score" a fortnight later. */
ALTER TABLE appraisal ADD COLUMN IF NOT EXISTS is_calibrated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN appraisal.ai_rating IS
  'Evidence-derived suggestion. NEVER merged into `rating` — the value of the number is that a manager can disagree with it. `is_calibrated` marks rows a human has decided, which the scorer will not overwrite.';

-- Existing rows carry a human rating, so they are calibrated by definition.
-- Leaving them false would let the first scorer run overwrite years of
-- judgements.
UPDATE appraisal SET is_calibrated = true WHERE rating IS NOT NULL AND is_calibrated = false;

-- ── 4. The review — the half the employee sees ─────────────────────────────

CREATE TABLE IF NOT EXISTS appraisal_review (
  appraisal_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_cycle_id uuid NOT NULL REFERENCES appraisal_cycle(appraisal_cycle_id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,

  -- The weighted roll-up of this employee's appraisal rows, frozen when the
  -- manager submits. Recomputing it on read would let a score an employee
  -- ACKNOWLEDGED change afterwards.
  overall_score numeric(5,2) CHECK (overall_score IS NULL OR overall_score >= 0),
  band          text,                          -- 'Exceeds', 'Meets', …
  manager_comment text,

  -- The narrative, written by the model from the same evidence the ratings came
  -- from and grounded in the tenant's own SOPs. A SUGGESTION for the manager to
  -- edit into `manager_comment` — it is never shown to the employee as-is.
  ai_summary   text,
  ai_model     text,
  ai_evidence  jsonb,

  /* DRAFT       — the manager is working on it.
   * SUBMITTED   — sent up; the figures freeze here.
   * ACKNOWLEDGED— the employee has read it and said so.
   * DISPUTED    — the employee disagrees, in writing. NOT a failure state and
   *               deliberately terminal-ish: the dispute is the record, and
   *               resolving it produces a new review rather than editing this
   *               one into agreement.
   * FINALISED   — closed off after acknowledgement or a resolved dispute. */
  status       text NOT NULL DEFAULT 'DRAFT'
               CHECK (status IN ('DRAFT','SUBMITTED','ACKNOWLEDGED','DISPUTED','FINALISED')),
  submitted_by uuid REFERENCES app_user(user_id),
  submitted_at timestamptz,

  -- The employee's own words. The column that makes this two-sided.
  employee_comment text,
  responded_at timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- One review per person per cycle. Two would mean two different accounts of
  -- the same six months, both signed.
  UNIQUE (appraisal_cycle_id, employee_id)
);
CREATE INDEX IF NOT EXISTS ix_appraisal_review_cycle ON appraisal_review(appraisal_cycle_id, status);
CREATE INDEX IF NOT EXISTS ix_appraisal_review_employee ON appraisal_review(employee_id);

COMMENT ON TABLE appraisal_review IS
  'One review per employee per cycle — the conversation, as opposed to `appraisal` which is one KPI. Carries the employee''s acknowledgement or dispute, which is what makes a performance record two-sided.';
COMMENT ON COLUMN appraisal_review.status IS
  'DISPUTED is not a failure state. The dispute IS the record; resolving it produces a new review rather than editing this one into agreement.';

-- DOWN
-- DROP TABLE IF EXISTS appraisal_review;
-- ALTER TABLE appraisal
--   DROP COLUMN IF EXISTS is_calibrated, DROP COLUMN IF EXISTS ai_scored_at,
--   DROP COLUMN IF EXISTS ai_evidence, DROP COLUMN IF EXISTS ai_rating,
--   DROP COLUMN IF EXISTS appraisal_cycle_id;
-- ALTER TABLE kpi_target
--   DROP COLUMN IF EXISTS scale_max, DROP COLUMN IF EXISTS auto_source,
--   DROP COLUMN IF EXISTS appraisal_cycle_id;
-- DROP TABLE IF EXISTS appraisal_cycle;
--
-- DESTRUCTIVE, and in a way that is worse than losing a number: dropping
-- appraisal_review discards every employee acknowledgement and every DISPUTE.
-- A disputed appraisal is the employee's side of a record that may later be
-- used to justify a dismissal, and it exists nowhere else — the manager's
-- account survives in `appraisal.comments`, theirs does not. Export
-- appraisal_review before running this.
