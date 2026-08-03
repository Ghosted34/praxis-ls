-- ============================================================================
-- TENANT DB — 0493 The reporting line: employee.reports_to
--
-- Audit finding B1. `0490` answered WHERE someone sits (scope = branch /
-- department) which is what approval routing needs. It did not answer WHO
-- REPORTS TO WHOM, and three things want that:
--
--   · `role.is_line_manager` is seeded as "Line Manager — approves for own team"
--     (9020_seed_rbac_events.sql:10) and nothing could resolve a team. With
--     scopes you can approximate one as "everyone in my branch"; that is a
--     departmental team, not direct reports.
--   · Escalation (audit W13) — "this has sat with the approver for four days,
--     send it up" has nowhere to send it.
--   · An org chart of PEOPLE. The Organigramme tab draws units and headcounts;
--     it cannot draw a reporting line that isn't recorded.
--
-- A REAL foreign key here, unlike the scope references in 0489/0490: this points
-- at `employee` in the SAME schema as the row holding it, so it is satisfiable
-- under both LIVE and TEST. ON DELETE SET NULL — deleting a manager must orphan
-- their reports, never delete them.
--
-- Cycles are prevented in code (employees.service.assertNoReportingCycle), not
-- by a constraint: Postgres cannot express "no cycles in a self-referencing
-- tree" declaratively without a trigger, and a trigger here would fire on every
-- employee write for a rule that only matters when reports_to changes.
--
-- Deliberately NOT added: a `position`/`job_title` lookup table. `job_title` is
-- still free text and has the same weakness `department` had, but that is a
-- second decision (a job catalogue is master data with its own lifecycle) and
-- this migration is about the reporting line only.
-- ============================================================================

ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS reports_to uuid REFERENCES employee(employee_id) ON DELETE SET NULL;

COMMENT ON COLUMN employee.reports_to IS
  'Line manager (self-reference). NULL = top of the tree or unrecorded. Cycles are prevented in employees.service, see 0493.';

-- "Who reports to X" is the common direction; partial because most rows are NULL
-- until a tenant records its reporting lines.
CREATE INDEX IF NOT EXISTS ix_employee_reports_to
    ON employee(reports_to)
 WHERE reports_to IS NOT NULL;

-- Nobody can be their own manager. This one case IS expressible as a constraint,
-- and it is the mistake a picker makes easiest.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'employee_not_own_manager'
       AND conrelid = 'employee'::regclass
  ) THEN
    ALTER TABLE employee
      ADD CONSTRAINT employee_not_own_manager CHECK (reports_to IS NULL OR reports_to <> employee_id);
  END IF;
END $$;
