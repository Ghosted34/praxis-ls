-- ============================================================================
-- TENANT DB — 12765 employee_allowance: the standing pay lines a contract states.
--
-- ── THE GAP ────────────────────────────────────────────────────────────────
--
-- Article 3 of a real contract does not state one number. It states a
-- decomposition:
--
--   Salaire de base :          600,000 FCFA
--   Prime de responsabilité :   50,000 FCFA
--   Total Brut Mensuel :       650,000 FCFA
--
-- `employee.base_salary` held the first line. `employee_earning` (0466) holds
-- one-off variable pay — a bonus or a commission FOR A NAMED PERIOD, picked up
-- once by that month's payroll run and marked APPLIED. Neither is a standing
-- monthly allowance that recurs until it is changed, so the middle line of that
-- contract had nowhere to live and the gross total could not be computed from
-- the record. Generating the contract would have printed a base salary as if it
-- were the whole remuneration — an understatement of the employer's obligation,
-- in the document that defines it.
--
-- ── WHY DATED ROWS AND NOT A jsonb BLOCK ───────────────────────────────────
--
-- A jsonb `allowances` on `employee` would have been one migration and no
-- joins. It also cannot be queried by payroll, cannot be date-bounded, and
-- overwrites its own history: the day a responsibility allowance is raised,
-- last month's payslip stops being explicable. `effective_on` / `ends_on` make
-- "what was this person entitled to in March" answerable, which is the question
-- a payroll dispute is actually about.
--
-- ── TAXABILITY IS RECORDED, NOT ASSUMED ────────────────────────────────────
--
-- Under Cameroonian payroll a prime is generally taxable and generally in the
-- CNPS base, but a transport allowance is capped and a genuine expense
-- reimbursement is neither. Getting that wrong understates or overstates every
-- statutory deduction, so it is three explicit booleans per line rather than a
-- rule inferred from the label. Defaults are the common case (taxable, in both
-- bases); the exceptions are typed once, on the line, where HR can see them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_allowance (
  employee_allowance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  -- 'Prime de responsabilité', 'Indemnité de transport', 'Prime de rendement'.
  label           text NOT NULL,
  -- A coarse family, so payroll and the contract can group and order lines
  -- without parsing the label a human typed.
  kind            text NOT NULL DEFAULT 'ALLOWANCE'
      CHECK (kind IN ('ALLOWANCE','BONUS','INDEMNITY','BENEFIT_IN_KIND','DEDUCTION')),
  amount          numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency        char(3),
  -- MONTHLY is the contract's own unit ("rémunération brute mensuelle"). The
  -- others exist so a 13th-month payment or a fixed annual indemnity does not
  -- have to be misrepresented as 1/12 of itself.
  periodicity     text NOT NULL DEFAULT 'MONTHLY'
      CHECK (periodicity IN ('MONTHLY','QUARTERLY','ANNUAL','ONE_OFF')),
  is_taxable      boolean NOT NULL DEFAULT true,
  in_cnps_base    boolean NOT NULL DEFAULT true,
  -- Does this line count toward the gross the contract prints? A benefit in
  -- kind (housing, a vehicle) is remuneration and is taxed, but is not paid in
  -- cash and must not inflate the "Total Brut Mensuel" figure.
  in_gross        boolean NOT NULL DEFAULT true,
  effective_on    date,
  ends_on         date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(user_id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR effective_on IS NULL OR ends_on >= effective_on)
);

-- The payroll/contract read is "everything live for this person", so the index
-- leads with the employee and carries the window.
CREATE INDEX IF NOT EXISTS ix_employee_allowance_employee
  ON employee_allowance (employee_id, effective_on);

CREATE OR REPLACE TRIGGER trg_employee_allowance_updated
  BEFORE UPDATE ON employee_allowance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE employee_allowance IS
  'Standing contractual pay lines (prime de responsabilité, indemnité de transport). Recurring and date-bounded — unlike employee_earning (0466), which is one-off variable pay for a named period.';

-- DOWN
--   DROP TABLE IF EXISTS employee_allowance;
