-- ============================================================================
-- 0466 — employee earnings (variable pay: bonuses / primes / commissions).
-- The link between performance (appraisals) and pay: an approved reward becomes a
-- PENDING earning for a period; payroll compute adds it to GROSS (so Cameroon
-- statutory withholdings apply — a prime is taxable), and validating the run marks
-- it APPLIED so it's paid once. source_ref ties an earning to its origin
-- (e.g. 'appraisal:<id>') and is unique, so re-recommending updates in place.
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_earning (
  employee_earning_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid REFERENCES employee(employee_id),
  entity_id       uuid REFERENCES corporate_entity(entity_id),
  period_code     text NOT NULL,                    -- YYYY-MM the earning is paid in
  kind            text NOT NULL DEFAULT 'BONUS' CHECK (kind IN ('BONUS','PRIME','COMMISSION','OTHER')),
  label           text,
  amount          numeric(18,2) NOT NULL CHECK (amount >= 0),
  source_ref      text,                             -- 'appraisal:<id>' etc.
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPLIED','CANCELLED')),
  payroll_run_id  uuid REFERENCES payroll_run(payroll_run_id),
  created_by      uuid REFERENCES app_user(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One earning per origin (so re-recommending an appraisal reward upserts).
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_earning_source ON employee_earning(source_ref) WHERE source_ref IS NOT NULL;
-- The payroll pick-up queue.
CREATE INDEX IF NOT EXISTS ix_employee_earning_pending ON employee_earning(entity_id, period_code) WHERE status = 'PENDING';
