-- ============================================================================
-- TENANT DB — 0698 payroll reads what actually happened: advances, absence,
--                  unpaid leave
--
-- ── THE MONEY THAT WENT OUT AND NEVER CAME BACK ────────────────────────────
--
-- `leave_request` has carried `kind = 'salary_advance'` and an `amount` since
-- 0330. A manager approves it, the employee is paid, and NOTHING EVER RECOVERS
-- IT. The service says so in a comment — "salary-advance ledger posting is
-- deferred to the Phase 1 posting engine" — and the posting engine landed while
-- the recovery did not. Every advance ever approved is an interest-free loan the
-- system has no record of expecting back.
--
-- A single "advance owing" column on the employee would not fix it. An advance
-- is recovered over MONTHS, by agreement, and both sides need to see the
-- schedule: how much a month, starting when, how much is left, and which
-- payroll run took each instalment. That is a plan and a set of instalments,
-- which is what these two tables are.
--
-- ── AND THE PAYSLIP THAT IGNORED THE MONTH ─────────────────────────────────
--
-- `compute()` was `gross = base_salary + approved earnings`. Attendance
-- reconciled its deductions (0697) into rows nothing read; unpaid leave
-- (0696) prorated nothing. This migration adds no columns for those — they are
-- already recorded — but it is where the payslip starts reading them, so the
-- reasoning belongs here with the rest.
--
-- ── WHY RECOVERY COMES OFF NET AND ABSENCE COMES OFF GROSS ─────────────────
--
-- This is the distinction the whole change turns on, and getting it backwards
-- overtaxes or undertaxes every affected employee:
--
--   AN ABSENCE OR A LATENESS REDUCES GROSS. The employee did not work that
--   time and did not earn that money, so CNPS and IRPP are computed on the
--   smaller figure. Deducting it from net would tax them on pay they never had.
--
--   AN ADVANCE RECOVERY COMES OFF NET. They earned the full salary and were
--   taxed on it — in an earlier month they simply received part of it early.
--   Taking it off gross would hand them a tax rebate for being lent money.
--
-- ── WHY THERE IS NO `recovered` COLUMN ─────────────────────────────────────
--
-- The outstanding balance is the plan's amount less its APPLIED instalments.
-- A stored total would be written from the run that applies an instalment, the
-- reversal that unwinds one and the correction that reschedules — and would
-- eventually disagree with all three. Same reasoning as the leave ledger (0696).
-- ============================================================================

-- ── 1. The plan ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS salary_advance (
  salary_advance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  /* The approved request this came from. UNIQUE: approving one request must
   * create at most one recovery plan, or a re-approval would double the debt.
   * Nullable because an advance may also be recorded directly by finance for
   * something that never went through the leave queue. */
  leave_request_id uuid UNIQUE REFERENCES leave_request(leave_request_id) ON DELETE SET NULL,
  entity_id    uuid REFERENCES corporate_entity(entity_id),

  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  instalments  smallint NOT NULL DEFAULT 1 CHECK (instalments BETWEEN 1 AND 60),
  -- The agreed monthly bite. Stored rather than derived from amount/instalments
  -- because the last instalment is the remainder and because a plan may be
  -- renegotiated to a smaller figure over more months.
  instalment_amount numeric(18,2) NOT NULL CHECK (instalment_amount > 0),
  -- '2026-09' — the first payroll period that should recover anything. Recovery
  -- normally starts the month AFTER the advance was paid.
  first_period_code text NOT NULL CHECK (first_period_code ~ '^\d{4}-\d{2}$'),

  /* ACTIVE     — instalments are still being taken.
   * SETTLED    — fully recovered. Set by the run that takes the last one.
   * SUSPENDED  — paused by agreement (illness, a disputed figure). Payroll
   *              takes nothing and the balance stands; this is what stops a
   *              suspension being faked by deleting the plan.
   * WRITTEN_OFF— forgiven. A decision, and it is audited as one. */
  status       text NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE','SETTLED','SUSPENDED','WRITTEN_OFF')),
  note         text,
  created_by   uuid REFERENCES app_user(user_id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_salary_advance_employee ON salary_advance(employee_id, status);
-- Payroll's question: "what is being recovered this month?"
CREATE INDEX IF NOT EXISTS ix_salary_advance_active ON salary_advance(first_period_code) WHERE status = 'ACTIVE';

COMMENT ON TABLE salary_advance IS
  'Recovery plan for a salary advance. The outstanding balance is amount − sum(APPLIED repayments); nothing stores a running total — see 0698.';

-- ── 2. The instalments ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS salary_advance_repayment (
  repayment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salary_advance_id uuid NOT NULL REFERENCES salary_advance(salary_advance_id) ON DELETE CASCADE,
  period_code  text NOT NULL CHECK (period_code ~ '^\d{4}-\d{2}$'),
  payroll_run_id uuid REFERENCES payroll_run(payroll_run_id) ON DELETE SET NULL,
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),

  /* PENDING  — this run computed it; the run has not been validated, so the
   *            employee has not actually repaid anything yet.
   * APPLIED  — the run was validated. THIS is what reduces the balance.
   * REVERSED — the run was rolled back. Kept rather than deleted so a
   *            recomputed month shows what happened rather than a gap. */
  status       text NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','APPLIED','REVERSED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
/* One live instalment per plan per period. A payroll run is recomputed freely
 * while it is OPEN/COMPUTED, and without this each recompute would stack
 * another instalment onto the same month. REVERSED rows are excluded so a
 * reversed month can be recomputed. */
CREATE UNIQUE INDEX IF NOT EXISTS ux_advance_repayment_period
  ON salary_advance_repayment(salary_advance_id, period_code)
  WHERE status <> 'REVERSED';
CREATE INDEX IF NOT EXISTS ix_advance_repayment_run ON salary_advance_repayment(payroll_run_id);

COMMENT ON COLUMN salary_advance_repayment.status IS
  'PENDING = computed by a run that has not been validated; the balance is unchanged. APPLIED = validated and actually recovered. REVERSED = the run was rolled back, kept for the record.';

/* Every advance already approved and never recovered.
 *
 * Backfilled as SUSPENDED, not ACTIVE, and that is the important choice: these
 * are real debts, and payroll must be able to see them — but nobody agreed a
 * schedule, and starting to take money out of somebody's next payslip because a
 * migration ran is exactly what this file exists to stop happening by accident.
 * They appear in the advances screen awaiting a plan, which is a conversation
 * the employer has to have.
 *
 * `first_period_code` is next month, so activating one does something sensible
 * without further editing. The whole amount in one instalment is the neutral
 * default, and the wrong one for most of these — which is the point of making
 * somebody look. */
INSERT INTO salary_advance (employee_id, leave_request_id, amount, instalments, instalment_amount,
                            first_period_code, status, note)
SELECT lr.employee_id, lr.leave_request_id, lr.amount, 1, lr.amount,
       to_char((date_trunc('month', now()) + interval '1 month')::date, 'YYYY-MM'),
       'SUSPENDED',
       'Approved before recovery existed (0698). Agree a schedule, then activate.'
  FROM leave_request lr
 WHERE lr.kind = 'salary_advance'
   AND lr.status IN ('APPROVED','TAKEN')
   AND lr.amount IS NOT NULL AND lr.amount > 0
   AND lr.employee_id IS NOT NULL
-- Belt and braces on a replay: the NOT EXISTS above already skips advances that
-- have a plan, and the unique constraint makes a concurrent second run a no-op
-- rather than a duplicate debt.
   AND NOT EXISTS (SELECT 1 FROM salary_advance sa WHERE sa.leave_request_id = lr.leave_request_id)
ON CONFLICT (leave_request_id) DO NOTHING;

-- ── 3. What a payslip is allowed to say ────────────────────────────────────

/* The run's inputs were `base_salary + earnings` and nothing else, so a payslip
 * could not show WHY it differed from the month before. These carry the totals
 * onto the item so a payslip is self-explaining — the per-day detail stays in
 * attendance_day and the per-instalment detail in the table above, and both are
 * reachable from the ids already on those rows. */
ALTER TABLE payroll_run_item ADD COLUMN IF NOT EXISTS attendance_deduction numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_item ADD COLUMN IF NOT EXISTS unpaid_leave_deduction numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_item ADD COLUMN IF NOT EXISTS advance_recovery numeric(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll_run_item.attendance_deduction IS
  'Unjustified lateness and absence for the period, off GROSS — the employee did not work the time and did not earn it, so statutory withholdings are computed on the smaller figure.';
COMMENT ON COLUMN payroll_run_item.advance_recovery IS
  'Advance instalment for the period, off NET — the employee earned and was taxed on the full salary and merely received part of it early.';

-- DOWN
-- ALTER TABLE payroll_run_item
--   DROP COLUMN IF EXISTS advance_recovery,
--   DROP COLUMN IF EXISTS unpaid_leave_deduction,
--   DROP COLUMN IF EXISTS attendance_deduction;
-- DROP TABLE IF EXISTS salary_advance_repayment;
-- DROP TABLE IF EXISTS salary_advance;
--
-- DESTRUCTIVE, and specifically about money owed TO the employer: dropping
-- these discards every recovery plan and every instalment already taken, so an
-- advance half-recovered becomes an advance with no record of repayment and the
-- employee has no evidence of what they have already paid back. The approvals
-- in `leave_request` survive, so the debts could be re-derived — but not the
-- schedules, and not what has been recovered so far.
--
-- If the reason for the rollback is the RECOVERY LOGIC rather than the schema,
-- do not run this: UPDATE salary_advance SET status = 'SUSPENDED' and payroll
-- takes nothing while every plan and instalment stays intact.
