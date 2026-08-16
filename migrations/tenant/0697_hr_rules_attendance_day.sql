-- ============================================================================
-- TENANT DB — 0697 the SOP made operational: house rules + a reconciled day
--
-- ── TWO THINGS THAT DID NOT EXIST ──────────────────────────────────────────
--
-- 1. THE COMPANY'S RULES WERE PROSE. `sop_document` holds a PDF in the vault.
--    "Arrive by 08:00, an hour late costs 10% of the day, three latenesses in a
--    month is a written query" lived in that PDF and nowhere the system could
--    act on. Every consequence was therefore somebody remembering — which means
--    it was applied unevenly, and an employee who disputed it was arguing with
--    a person rather than with a rule.
--
-- 2. NOTHING RECONCILED A DAY. `attendance_log` is punches. It records that
--    somebody clocked in at 09:14; it has no opinion about whether that was
--    late, and `lateness()` in the service COMPUTED THAT NUMBER AND THREW IT
--    AWAY on every read. Worse, the absence of a punch produced no row at all,
--    so "absent", "on approved leave", "it was a public holiday" and "nobody
--    has clocked in yet today" were the same thing: nothing.
--
-- `hr_rule` is the first; `attendance_day` is the second. Together they are
-- what lets payroll (0698) charge a deduction that an employee can trace to a
-- clause, a date and a decision.
--
-- ── WHY A DAY IS A ROW, AND WHY IT IS WRITTEN BY A JOB ──────────────────────
--
-- Deriving the day on read is how the current bug happened: the number existed
-- only for as long as the response, so nothing could link a query to it, nobody
-- could waive it, and payroll could not read it. A row can be justified, cited
-- and paid against.
--
-- It is written by a nightly reconciler rather than at clock-in because most of
-- what decides a day is NOT the punch: an approved leave request, a public
-- holiday, a weekend, or the absence of any punch at all. Only a pass over the
-- roster after the day is over knows which.
--
-- ── WHY THE DEDUCTION IS FROZEN ON THE ROW ─────────────────────────────────
--
-- `daily_rate`, `deduction_pct` and `deduction_amount` are stored, not derived.
-- A rule edited in March must not silently re-price January's deductions, and a
-- salary raise must not retroactively increase what a past lateness cost. The
-- row records what was charged, under the rule in force, at the rate in force.
--
-- ── WAIVING, AND WHY `justified` DOES NOT ERASE THE AMOUNT ─────────────────
--
-- A waived day keeps `deduction_amount` and flips `justified` to true. Payroll
-- ignores justified days. Keeping the figure is what makes a waiver REVERSIBLE
-- — upholding it later restores the same number rather than recomputing one —
-- and what lets a manager see what a waiver cost the company.
-- ============================================================================

-- ── 1. The rules ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_rule (
  hr_rule_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         citext UNIQUE NOT NULL,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,

  /* LATENESS  — measured per day, against the tiers below.
   * ABSENCE   — a working day with no punch and no approved leave.
   * REWARD    — measured per MONTH, against metric/comparator/threshold.
   * CONDUCT   — not measured at all; a clause a manager cites when raising a
   *             query by hand, so the query names the rule rather than an
   *             opinion. */
  kind         text NOT NULL CHECK (kind IN ('LATENESS','ABSENCE','REWARD','CONDUCT')),

  -- REWARD only: what is counted over the month. Free text rather than an enum
  -- so a tenant can add a metric the reward engine learns later without a
  -- migration; the engine ignores metrics it cannot compute and says so.
  metric       text,
  comparator   text CHECK (comparator IS NULL OR comparator IN ('gte','lte')),
  threshold    numeric(12,2),

  /* LATENESS only. Ordered, first match from the top after N minutes:
   *   [{"after_minutes":60,"deduction_pct":10}, …]
   * jsonb rather than a child table because a tier list is edited as a whole,
   * is never queried across rules, and is meaningless apart from its rule. */
  tiers        jsonb NOT NULL DEFAULT '[]'::jsonb,

  /* What the rule DOES. DEDUCT_PCT_DAY is a percentage of that day's pay (the
   * lateness case); the BONUS_* effects resolve against the monthly salary.
   * QUERY_ONLY costs nothing and only raises the question — which is the right
   * default for a first offence and for every CONDUCT rule. */
  effect       text NOT NULL DEFAULT 'QUERY_ONLY'
               CHECK (effect IN ('DEDUCT_PCT_DAY','DEDUCT_FIXED','BONUS_FIXED',
                                 'BONUS_PCT_SALARY','SALARY_INCREASE_PCT','QUERY_ONLY')),
  effect_value numeric(12,2) CHECK (effect_value IS NULL OR effect_value >= 0),

  -- Raise an HR query the employee must answer. The deduction stands until the
  -- query is waived, which is what makes it a conversation rather than a fine.
  auto_query   boolean NOT NULL DEFAULT false,
  query_severity text NOT NULL DEFAULT 'WARNING'
               CHECK (query_severity IN ('INFO','WARNING','SERIOUS')),
  -- How long the employee has to answer before it is chased. Labour practice
  -- gives 48-72h; 2 days is the default rather than a hard-coded constant.
  query_due_days smallint NOT NULL DEFAULT 2 CHECK (query_due_days >= 0),

  /* THE CLAUSE THIS ENFORCES. The whole point of the table: a deduction an
   * employee can trace to the SOP they were given on their first day is a rule;
   * one they cannot is a surprise. Nullable because a tenant may configure a
   * rule before writing the document, and ON DELETE SET NULL because deleting
   * the document must not delete the rule that has been charging people. */
  sop_document_id uuid REFERENCES sop_document(sop_document_id) ON DELETE SET NULL,

  is_active    boolean NOT NULL DEFAULT true,
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hr_rule_kind ON hr_rule(kind) WHERE is_active;

COMMENT ON COLUMN hr_rule.tiers IS
  'LATENESS only. Ordered [{after_minutes, deduction_pct}], first match from the top. Empty = the rule flags lateness without costing anything.';
COMMENT ON COLUMN hr_rule.sop_document_id IS
  'The SOP clause this rule enforces. A deduction an employee can trace to the document they were given is a rule; one they cannot is a surprise.';

/* Seeded INACTIVE, every one of them.
 *
 * This is deliberate and is the only defensible default: money must not start
 * coming out of anybody's pay because a migration ran. The tenant switches each
 * rule on from HR settings, having read what it does — which is also the moment
 * they attach the SOP clause it enforces. The tiers mirror the common practice
 * (an hour late costs a tenth of the day) so the first thing an HR manager sees
 * is a sensible shape to edit rather than an empty form. */
INSERT INTO hr_rule (code, name, description, kind, tiers, effect, auto_query, query_severity, is_active, is_system)
VALUES
  ('LATENESS_TIERED', 'Lateness deduction',
   'Arriving after the grace window costs a share of that day''s pay, on a rising scale.',
   'LATENESS',
   '[{"after_minutes":60,"deduction_pct":10},{"after_minutes":120,"deduction_pct":20},{"after_minutes":180,"deduction_pct":30}]'::jsonb,
   'DEDUCT_PCT_DAY', true, 'WARNING', false, true),
  ('ABSENCE_UNEXCUSED', 'Unexcused absence',
   'A working day with no clock-in and no approved leave.',
   'ABSENCE', '[]'::jsonb, 'DEDUCT_PCT_DAY', true, 'SERIOUS', false, true)
ON CONFLICT (code) DO NOTHING;

-- A full day's pay for an unexcused absence, set separately so the seed above
-- reads as "what it does" and this as "how much".
UPDATE hr_rule SET effect_value = 100 WHERE code = 'ABSENCE_UNEXCUSED' AND effect_value IS NULL;

-- ── 2. When each person is expected ────────────────────────────────────────

/* Lateness was measured against ONE tenant-wide `hr.attendance_policy`, so a
 * driver starting at 06:00 and an accountant starting at 08:00 were held to the
 * same clock and one of them was wrong every single day. These are per-person
 * overrides; the tenant policy remains the fallback. */
ALTER TABLE employee ADD COLUMN IF NOT EXISTS expected_start_time text
  CHECK (expected_start_time IS NULL OR expected_start_time ~ '^[0-2][0-9]:[0-5][0-9]$');
ALTER TABLE employee ADD COLUMN IF NOT EXISTS expected_end_time text
  CHECK (expected_end_time IS NULL OR expected_end_time ~ '^[0-2][0-9]:[0-5][0-9]$');
-- Which weekdays this person works, as JS day numbers (0 = Sunday). NULL = the
-- tenant's `hr.weekend_days` decides, which is what every employee does today.
ALTER TABLE employee ADD COLUMN IF NOT EXISTS work_days smallint[];
ALTER TABLE employee ADD COLUMN IF NOT EXISTS grace_minutes smallint
  CHECK (grace_minutes IS NULL OR grace_minutes >= 0);

COMMENT ON COLUMN employee.work_days IS
  'JS day numbers (0=Sunday) this employee works. NULL = fall back to the tenant weekend setting. Drives which days the reconciler expects a punch on.';

-- ── 3. The reconciled day ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance_day (
  attendance_day_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  work_date    date NOT NULL,

  /* PRESENT / LATE  — a punch, on time or not.
   * ABSENT          — a working day, no punch, no approved leave. Costs money.
   * ON_LEAVE        — approved leave covers this date. THE ROW THAT STOPS AN
   *                   APPROVED HOLIDAY READING AS AN ABSENCE, which is what
   *                   `absence()` does today.
   * OFF / WEEKEND / HOLIDAY — not a working day for this person. Recorded
   *                   rather than skipped so the month has a complete calendar
   *                   and "why was nothing charged?" has an answer. */
  status       text NOT NULL DEFAULT 'ABSENT'
               CHECK (status IN ('PRESENT','LATE','ABSENT','ON_LEAVE','OFF','WEEKEND','HOLIDAY')),

  -- Snapshots, not joins: the schedule an employee was held to on a given day
  -- must not change when their shift is edited next quarter.
  expected_start_time text,
  grace_minutes  smallint NOT NULL DEFAULT 0,

  first_clock_in_at  timestamptz,
  last_clock_out_at  timestamptz,
  minutes_late   integer NOT NULL DEFAULT 0 CHECK (minutes_late >= 0),

  -- Money at stake. Frozen — see the header.
  daily_rate     numeric(18,2) NOT NULL DEFAULT 0,
  deduction_pct  numeric(5,2)  NOT NULL DEFAULT 0,
  deduction_amount numeric(18,2) NOT NULL DEFAULT 0,

  -- Waived. The amount is KEPT so the waiver is reversible and its cost visible.
  justified      boolean NOT NULL DEFAULT false,
  justified_by   uuid REFERENCES app_user(user_id),
  justified_at   timestamptz,
  justification  text,

  -- Provenance: which rule charged this, which query asks about it, which leave
  -- excuses it, which punch produced it.
  hr_rule_id     uuid REFERENCES hr_rule(hr_rule_id) ON DELETE SET NULL,
  hr_query_id    uuid REFERENCES hr_query(hr_query_id) ON DELETE SET NULL,
  leave_request_id uuid REFERENCES leave_request(leave_request_id) ON DELETE SET NULL,
  attendance_id  uuid REFERENCES attendance_log(attendance_id) ON DELETE SET NULL,

  reconciled_at  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- One row per person per day. The reconciler is re-runnable and upserts on
  -- this; without it a second pass would charge the same lateness twice.
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS ix_attendance_day_employee ON attendance_day(employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS ix_attendance_day_date ON attendance_day(work_date DESC);
-- The payroll query: what does this month owe, and what has been waived.
CREATE INDEX IF NOT EXISTS ix_attendance_day_chargeable
  ON attendance_day(work_date) WHERE deduction_amount > 0 AND justified = false;

COMMENT ON TABLE attendance_day IS
  'One reconciled row per employee per date. Written by the attendance-reconcile job, never at clock-in — most of what decides a day (approved leave, a holiday, the ABSENCE of a punch) is not the punch. Deduction figures are frozen at reconciliation.';
COMMENT ON COLUMN attendance_day.justified IS
  'Waived. The deduction_amount is deliberately KEPT so the waiver is reversible and its cost visible; payroll ignores justified days.';

-- The reconciler needs the tenant timezone to decide what "08:00" means. Server
-- local time is not it: `lateness()` read `getHours()` off the server clock, so
-- on a UTC host every Cameroonian employee appeared to arrive an hour early.
INSERT INTO setting (section, key, value)
VALUES ('hr', 'timezone', '"Africa/Douala"'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS attendance_day;
-- ALTER TABLE employee
--   DROP COLUMN IF EXISTS grace_minutes, DROP COLUMN IF EXISTS work_days,
--   DROP COLUMN IF EXISTS expected_end_time, DROP COLUMN IF EXISTS expected_start_time;
-- DROP TABLE IF EXISTS hr_rule;
-- DELETE FROM setting WHERE section = 'hr' AND key = 'timezone';
--
-- DESTRUCTIVE. Dropping attendance_day discards every reconciled day — the
-- evidence behind every deduction already taken and every waiver already
-- granted, which is exactly what an employee disputing their pay would ask to
-- see. It can be rebuilt from attendance_log ONLY for days whose rules and
-- salaries have not changed since; anything older re-prices under today's
-- figures, which is the drift the frozen columns exist to prevent.
--
-- If the reason for the rollback is the RECONCILER rather than the schema, do
-- not run this: deactivate the rules (UPDATE hr_rule SET is_active = false) and
-- every day reconciles to zero deduction while the history stays intact.
