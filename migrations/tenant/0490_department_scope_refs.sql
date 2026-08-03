-- ============================================================================
-- TENANT DB — 0490 Departments become scopes
--
-- "Department" has never existed as a thing in this system. It was a free-text
-- column typed into three unrelated forms:
--
--     employee.department          typed on the employee form
--     vacancy.department           typed on the vacancy form, then COPIED onto
--                                  employee.department at hire
--                                  (vacancy.service.js:62)
--     purchase_request.department  typed on the PR form
--
-- No table, no list, no validation. `employees.repo.js:43` filters with
-- `e.department = $n` — exact string equality — so "Operations", "operations"
-- and "Ops" are three departments, and "everyone in Operations" is a query the
-- ERP cannot answer correctly. Audit finding B1/B4.
--
-- The registry already exists: `scope` (0110_rbac.sql) is described in its own
-- schema as "the entity / branch / department a user belongs to", it nests via
-- parent_scope_id, and it is the tree approval steps route through. Making
-- departments scopes means an employee's department and the scope their
-- approvals route to stop being two unrelated strings — the B4 gap.
--
-- SHAPE. `scope_id` is the reference; `department` stays as a display snapshot,
-- the same pattern 0477_line_item_refs used for line items (the row's label is
-- kept so documents and existing records render unchanged). Nothing is dropped
-- and no existing row breaks.
--
-- NO FOREIGN KEY, deliberately — the same reason as 0489. `scope` is identity
-- data pinned to the LIVE schema, while employee/vacancy/purchase_request are
-- business data written to the env-selected one. A declared FK would resolve
-- inside the writing schema and so reject valid ids under TEST, where
-- `sandbox.scope` is empty by construction. Validated in code instead.
--
-- BACKFILL matches the existing free text against scope names and codes,
-- case- and whitespace-insensitively, and only where the match is unambiguous
-- (exactly one scope). Anything else keeps scope_id NULL and its text — a wrong
-- link is worse than an unlinked row, and the text is still there to fix by
-- hand. Under `sandbox` the scope table is empty, so nothing matches and
-- nothing is claimed; that is correct, not a failure.
-- ============================================================================

ALTER TABLE employee         ADD COLUMN IF NOT EXISTS scope_id uuid;
ALTER TABLE vacancy          ADD COLUMN IF NOT EXISTS scope_id uuid;
ALTER TABLE purchase_request ADD COLUMN IF NOT EXISTS scope_id uuid;

COMMENT ON COLUMN employee.scope_id IS
  'Department/branch (scope). Identity data in the live schema — no FK on purpose, see 0489/0490. department is a display snapshot.';
COMMENT ON COLUMN vacancy.scope_id IS
  'Department/branch (scope). No FK on purpose, see 0490.';
COMMENT ON COLUMN purchase_request.scope_id IS
  'Department/branch (scope). No FK on purpose, see 0490.';

CREATE INDEX IF NOT EXISTS ix_employee_scope         ON employee(scope_id)         WHERE scope_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_vacancy_scope          ON vacancy(scope_id)          WHERE scope_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_purchase_request_scope ON purchase_request(scope_id) WHERE scope_id IS NOT NULL;

-- Normalise for matching: trim, collapse inner whitespace, casefold.
CREATE OR REPLACE FUNCTION dept_match_key(t text) RETURNS text
  LANGUAGE sql IMMUTABLE AS
$$ SELECT lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

DO $$
DECLARE
  r       RECORD;
  v_id    uuid;
  v_n     integer;
  v_total integer := 0;
  v_amb   integer := 0;
BEGIN
  IF to_regclass('scope') IS NULL THEN
    RAISE WARNING '[0490] no scope table in this schema — backfill skipped';
    RETURN;
  END IF;

  FOR r IN
    SELECT 'employee' AS tbl, employee_id AS id, department AS dept FROM employee
      WHERE scope_id IS NULL AND coalesce(btrim(department), '') <> ''
    UNION ALL
    SELECT 'vacancy', vacancy_id, department FROM vacancy
      WHERE scope_id IS NULL AND coalesce(btrim(department), '') <> ''
    UNION ALL
    SELECT 'purchase_request', pr_id, department FROM purchase_request
      WHERE scope_id IS NULL AND coalesce(btrim(department), '') <> ''
  LOOP
    SELECT count(*), min(s.scope_id) INTO v_n, v_id
      FROM scope s
     WHERE dept_match_key(s.name) = dept_match_key(r.dept)
        OR dept_match_key(s.code) = dept_match_key(r.dept);

    IF v_n = 1 THEN
      EXECUTE format('UPDATE %I SET scope_id = $1 WHERE %I = $2',
                     r.tbl,
                     CASE r.tbl WHEN 'employee' THEN 'employee_id'
                                WHEN 'vacancy'  THEN 'vacancy_id'
                                ELSE 'pr_id' END)
        USING v_id, r.id;
      v_total := v_total + 1;
    ELSIF v_n > 1 THEN
      v_amb := v_amb + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[0490] linked % row(s) to a scope', v_total;
  IF v_amb > 0 THEN
    RAISE WARNING '[0490] % row(s) matched more than one scope and were left unlinked', v_amb;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Backfill is convenience; the columns and the code path matter more. Named,
  -- never silent — the lesson of 0469.
  RAISE WARNING '[0490] backfill failed (columns still added): %', SQLERRM;
END $$;
