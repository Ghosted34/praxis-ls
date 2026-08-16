-- ============================================================================
-- TENANT DB — 0696 leave: types, entitlement, balances, and a real day count
--
-- ── WHAT WAS THERE ─────────────────────────────────────────────────────────
--
--   leave_request(employee_id, kind, starts_on, ends_on, amount, status)
--
-- and nothing else. `kind` was free text ('leave' | 'salary_advance' |
-- 'mission'), the dates were not even checked against each other, and there was
-- no entitlement, no accrual and no balance anywhere in the schema.
--
-- The consequence is not subtle: AN APPROVER APPROVES AGAINST NOTHING. The
-- screen shows a name and two dates, the manager clicks Approve, and no part of
-- the system knows whether that person had a single day left — or has now taken
-- forty. Nothing counts the days either, so "3 days" and "3 weeks" are the same
-- record. Under the Cameroon labour code annual leave accrues at 1.5 working
-- days per month of service; none of that was modelled, so the statutory
-- position of every employee was unknown to the product.
--
-- ── WHY A LEDGER AND NOT A BALANCE COLUMN ──────────────────────────────────
--
-- A `days_remaining` column is one number with no history: when an employee
-- disputes it — and leave is the single most disputed figure in HR — there is
-- nothing to show them. Worse, it has to be right after every concurrent
-- approval, cancellation and mid-year adjustment, and a column that is written
-- from four places eventually disagrees with all of them.
--
-- `leave_ledger` is signed movements and the balance is their SUM. Every day of
-- entitlement can be traced to the month it accrued in, the request that
-- consumed it, or the person who adjusted it and why. A cancellation does not
-- delete the consumption — it posts the opposite entry, so the record shows
-- that leave was booked and given back rather than pretending it never was.
--
-- ── WHY ACCRUAL IS POSTED, NOT DERIVED ─────────────────────────────────────
--
-- Deriving "months employed × rate" on read is tempting and wrong the first
-- time a tenant changes the rate, promotes someone onto a different one, or
-- hires mid-month: the past silently re-computes under the new rule and last
-- year's approved balance changes. Accrual is therefore POSTED monthly by the
-- `leave-accrual` job, and `ux_leave_ledger_accrual` makes that job idempotent
-- — re-running it for a month that already accrued is a no-op rather than a
-- doubling, which matters because a monthly job WILL be re-run by hand.
--
-- ── WHY PUBLIC HOLIDAYS ARE A TABLE ────────────────────────────────────────
--
-- "Working days between two dates" cannot be computed without them, and a
-- national holiday calendar is not something to hard-code: Cameroon's fixed
-- dates are stable, but Good Friday, Eid al-Fitr and Eid al-Adha move every
-- year and are declared by the state. The fixed ones are seeded as recurring;
-- the moveable ones are the tenant's to add, and until they do the count is
-- honestly one day out rather than silently wrong in a way nobody can fix.
-- ============================================================================

-- ── 1. What kinds of leave this tenant grants ──────────────────────────────

/* DATA, not an enum. Every jurisdiction and every collective agreement carries
 * a different set — annual, sick, maternity, paternity, compassionate, study,
 * unpaid — and a CHECK constraint here would mean a migration every time an HR
 * manager recognised a new one. */
CREATE TABLE IF NOT EXISTS leave_type (
  leave_type_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            citext UNIQUE NOT NULL,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  -- Unpaid leave still consumes calendar and still needs approving; what it
  -- must NOT do is leave the payslip untouched. Payroll reads this.
  is_paid         boolean NOT NULL DEFAULT true,
  -- Statutory accrual, days per month of service. NULL = not accrued: sick and
  -- maternity are granted per event against a ceiling, not banked month by
  -- month, and giving them a rate would show an employee "12.5 sick days
  -- saved up", which is not what sick leave is.
  accrual_days_per_month numeric(6,3) CHECK (accrual_days_per_month IS NULL OR accrual_days_per_month >= 0),
  -- A ceiling regardless of accrual — the per-event allowance for the types
  -- above, and a cap on hoarding for the ones that do accrue.
  max_days_per_year      numeric(6,1) CHECK (max_days_per_year IS NULL OR max_days_per_year >= 0),
  -- How much unused entitlement survives into next year. 0 = use it or lose it.
  max_carryover_days     numeric(6,1) NOT NULL DEFAULT 0 CHECK (max_carryover_days >= 0),
  -- Sick leave without a certificate is the classic dispute; the request
  -- refuses to be created without the attachment when this is on.
  requires_document      boolean NOT NULL DEFAULT false,
  -- TRUE: weekends and public holidays are skipped when counting (annual
  -- leave). FALSE: calendar days run straight through (maternity, which is
  -- counted in weeks and does not pause for a Sunday).
  counts_working_days    boolean NOT NULL DEFAULT true,
  -- May the balance go below zero? Advancing next year's leave is a real
  -- decision some employers make; it must be deliberate, not a rounding error.
  allow_negative         boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  -- Seeded below. A tenant may rename or deactivate one, but deleting the type
  -- that half the ledger points at is not an edit — it is data loss.
  is_system       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN leave_type.accrual_days_per_month IS
  'Days of entitlement earned per month of service, posted monthly by the leave-accrual job. NULL = this type is not banked (granted per event against max_days_per_year instead).';

/* Cameroon's statutory floor (Code du Travail art. 89: 1.5 working days per
 * month of service = 18 days a year) plus the types every employer needs on day
 * one. Rates and ceilings are DEFAULTS a tenant edits — a collective agreement
 * commonly improves on the floor, and nothing here should stop it. */
INSERT INTO leave_type (code, name, is_paid, accrual_days_per_month, max_days_per_year, max_carryover_days, requires_document, counts_working_days, is_system)
VALUES
  ('ANNUAL',       'Annual leave',        true,  1.5,  NULL, 18,  false, true,  true),
  ('SICK',         'Sick leave',          true,  NULL, 30,   0,   true,  true,  true),
  ('MATERNITY',    'Maternity leave',     true,  NULL, 98,   0,   true,  false, true),
  ('PATERNITY',    'Paternity leave',     true,  NULL, 3,    0,   false, true,  true),
  ('COMPASSIONATE','Compassionate leave', true,  NULL, 5,    0,   false, true,  true),
  ('UNPAID',       'Unpaid leave',        false, NULL, NULL, 0,   false, true,  true)
ON CONFLICT (code) DO NOTHING;

-- ── 2. The days that are not working days ──────────────────────────────────

/* Without this, "working days between two dates" is weekdays only, which
 * over-counts every leave request that spans a national holiday — the employee
 * is charged for a day nobody worked. */
CREATE TABLE IF NOT EXISTS public_holiday (
  public_holiday_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_on      date NOT NULL,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  -- TRUE: the same day every year (1 January). The year stored in `holiday_on`
  -- is then only a carrier for the month and day, and the counter matches on
  -- those alone — so a fixed holiday does not need re-seeding every December.
  -- FALSE: this date and no other (Easter, Eid, a declared day of mourning).
  is_recurring    boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- One entry per date. A holiday declared twice would be counted twice and shave
-- a day off every request that spans it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_public_holiday_date ON public_holiday(holiday_on);
CREATE INDEX IF NOT EXISTS ix_public_holiday_recurring ON public_holiday(is_recurring) WHERE is_active;

/* Cameroon's FIXED national holidays. The year is arbitrary (see is_recurring)
 * — 2000 is used so nobody mistakes these rows for a particular year's
 * calendar. The MOVEABLE holidays are deliberately absent: Good Friday,
 * Ascension, Eid al-Fitr and Eid al-Adha are declared per year, and a wrong
 * date seeded here would be worse than an absent one, because it would be
 * trusted. */
INSERT INTO public_holiday (holiday_on, name, is_recurring)
VALUES
  (DATE '2000-01-01', 'New Year''s Day',          true),
  (DATE '2000-02-11', 'Youth Day',                true),
  (DATE '2000-05-01', 'Labour Day',               true),
  (DATE '2000-05-20', 'National Day',             true),
  (DATE '2000-08-15', 'Assumption',               true),
  (DATE '2000-12-25', 'Christmas Day',            true)
ON CONFLICT (holiday_on) DO NOTHING;

-- ── 3. When service started ────────────────────────────────────────────────

/* The employee master has carried a name, a salary and a CNPS number since
 * 0300 and has NEVER carried a start date. Statutory accrual is "per month of
 * SERVICE", so without this the accrual job has no anchor and neither has
 * anything else that depends on tenure — notice periods, long-service
 * entitlement, the end of probation.
 *
 * Backfilled from `created_at`, which is the honest available proxy and not a
 * guess dressed as a fact: it says "this employee has been known to the system
 * since here". For a workforce loaded at go-live that is also the right
 * behaviour — entitlement starts accruing when the product starts tracking it,
 * matching the note on leave_request below. An HR manager correcting a
 * ten-year employee's real start date makes the accrual right from that point;
 * inventing a 2015 date here would make it wrong and unquestionable. */
ALTER TABLE employee ADD COLUMN IF NOT EXISTS hired_on date;
UPDATE employee SET hired_on = created_at::date WHERE hired_on IS NULL;

COMMENT ON COLUMN employee.hired_on IS
  'Date service started. Drives leave accrual (per month of service) and any other tenure calculation. Backfilled from created_at in 0696 — correct it where the real date is known.';

-- ── 4. The ledger ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_ledger (
  leave_ledger_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES leave_type(leave_type_id),
  -- Entitlement is annual. Carrying the year on the row is what makes "what was
  -- their balance at the end of 2025?" answerable after 2026 has started.
  period_year     smallint NOT NULL CHECK (period_year BETWEEN 2000 AND 2200),
  -- Set on ACCRUAL only, and only so the unique index below can make the
  -- monthly job re-runnable. NULL on every other kind.
  period_month    smallint CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12),
  kind            text NOT NULL CHECK (kind IN ('ACCRUAL','CARRYOVER','TAKEN','RETURNED','ADJUSTMENT','FORFEIT')),
  -- SIGNED. Positive adds entitlement (accrual, carryover, a correction in the
  -- employee's favour, leave given back); negative consumes it (taken,
  -- forfeited at year end). The balance is the sum, and the sign is the whole
  -- design — a magnitude plus a kind means every reader has to remember which
  -- kinds subtract.
  days            numeric(6,2) NOT NULL CHECK (days <> 0),
  leave_request_id uuid REFERENCES leave_request(leave_request_id) ON DELETE SET NULL,
  -- Required on ADJUSTMENT by the service: a balance moved by hand with no
  -- stated reason is exactly the entry an employee will later contest.
  note            text,
  created_by      uuid REFERENCES app_user(user_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_leave_ledger_balance
  ON leave_ledger(employee_id, leave_type_id, period_year);
CREATE INDEX IF NOT EXISTS ix_leave_ledger_request
  ON leave_ledger(leave_request_id) WHERE leave_request_id IS NOT NULL;

/* The accrual job's idempotency. A monthly job is re-run by hand — after a
 * deploy, after a failure, after somebody wonders whether it ran — and without
 * this every re-run would hand the whole workforce another month of leave. */
CREATE UNIQUE INDEX IF NOT EXISTS ux_leave_ledger_accrual
  ON leave_ledger(employee_id, leave_type_id, period_year, period_month)
  WHERE kind = 'ACCRUAL';

COMMENT ON TABLE leave_ledger IS
  'Signed movements of leave entitlement; the balance is their SUM. Nothing stores a balance — see 0696. Positive: ACCRUAL, CARRYOVER, RETURNED, a favourable ADJUSTMENT. Negative: TAKEN, FORFEIT.';

-- ── 5. What a leave request now carries ────────────────────────────────────

ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS leave_type_id  uuid REFERENCES leave_type(leave_type_id);
-- Computed at request time from the dates, the type's working-day rule and the
-- holiday calendar — and STORED, because the calendar can change afterwards and
-- a request must be charged what it was charged when it was approved.
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS days           numeric(6,2) CHECK (days IS NULL OR days > 0);
-- Half days at either end. The common real request is "from Wednesday
-- afternoon until Monday morning", and rounding it up to whole days at both
-- ends costs the employee a day of entitlement they did not take.
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS half_day_start boolean NOT NULL DEFAULT false;
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS half_day_end   boolean NOT NULL DEFAULT false;
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS reason         text;
-- The sick note, for types with requires_document.
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS document_vault_id uuid REFERENCES document_vault(doc_id);
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS decided_by     uuid REFERENCES app_user(user_id);
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS decided_at     timestamptz;
ALTER TABLE leave_request ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz;

/* A range that runs backwards produced a negative day count, which the ledger
 * would have posted as entitlement GAINED. Refused rather than tolerated.
 * NOT VALID: rows written before this migration were never day-counted, and
 * failing the whole migration on one historical typo helps nobody — new and
 * updated rows are checked from here on. */
DO $$ BEGIN
  ALTER TABLE leave_request ADD CONSTRAINT ck_leave_request_range
    CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* CANCELLED and TAKEN. APPROVED was terminal, so an employee whose plans
 * changed had no way to give the days back — the manager's only option was to
 * leave the record standing and remember. TAKEN is the end of the story rather
 * than a decision: it marks leave that has actually been served, which is what
 * distinguishes "booked for December" from "already had it".
 * Dropped and re-added: a CHECK cannot be widened in place. */
ALTER TABLE leave_request DROP CONSTRAINT IF EXISTS leave_request_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_request_status_check') THEN
    ALTER TABLE leave_request ADD CONSTRAINT leave_request_status_check
      CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED','TAKEN'));
  END IF;
END $$;

COMMENT ON COLUMN leave_request.days IS
  'Working (or calendar, per leave_type.counts_working_days) days this request consumes, half days included. Frozen at request time — the holiday calendar may change later and an approved request must not silently re-price.';

/* Existing rows: `kind = ''leave''` with no type. Pointed at ANNUAL so the
 * screens and the balance view have something to group by, WITHOUT posting a
 * ledger entry for any of them — those days were approved under no entitlement
 * model at all, and inventing consumption for them would open every employee's
 * balance in deficit for leave the system never tracked. The honest position is
 * that entitlement starts accruing now. */
UPDATE leave_request
   SET leave_type_id = (SELECT leave_type_id FROM leave_type WHERE code = 'ANNUAL')
 WHERE leave_type_id IS NULL
   AND coalesce(kind, 'leave') = 'leave';

CREATE INDEX IF NOT EXISTS ix_leave_request_employee_dates
  ON leave_request(employee_id, starts_on, ends_on)
  WHERE status IN ('REQUESTED','APPROVED','TAKEN');

-- DOWN
-- ALTER TABLE leave_request DROP CONSTRAINT IF EXISTS leave_request_status_check;
-- ALTER TABLE leave_request ADD CONSTRAINT leave_request_status_check
--   CHECK (status IN ('REQUESTED','APPROVED','REJECTED'));
-- ALTER TABLE leave_request
--   DROP CONSTRAINT IF EXISTS ck_leave_request_range,
--   DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS decided_at,
--   DROP COLUMN IF EXISTS decided_by, DROP COLUMN IF EXISTS document_vault_id,
--   DROP COLUMN IF EXISTS reason, DROP COLUMN IF EXISTS half_day_end,
--   DROP COLUMN IF EXISTS half_day_start, DROP COLUMN IF EXISTS days,
--   DROP COLUMN IF EXISTS leave_type_id;
-- DROP TABLE IF EXISTS leave_ledger;
-- DROP TABLE IF EXISTS public_holiday;
-- DROP TABLE IF EXISTS leave_type;
-- ALTER TABLE employee DROP COLUMN IF EXISTS hired_on;
--
-- DESTRUCTIVE, and worth stating plainly: dropping leave_ledger discards every
-- day of entitlement the workforce has accrued, and it cannot be rebuilt from
-- leave_request — accruals and adjustments have no other home. Statuses are
-- collapsed first because CANCELLED and TAKEN rows would fail the narrower
-- CHECK; a cancelled request reverting to REQUESTED reopens a decision that was
-- made, so run the status update above only after exporting the table.
