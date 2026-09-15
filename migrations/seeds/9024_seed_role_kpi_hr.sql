-- ============================================================================
-- SEED (per tenant schema) — 9024 the curated Human Capital band, for the HR
-- role.
--
-- Companion to 9023_seed_role_kpi_defaults.sql and to the six tiles PR-4 of
-- doc/KPI_BAND_ENGINEERING_GUIDE.md flips live (D12: Human Capital is a
-- first-class domain, six tiles deep). 9023 shipped BEFORE those tiles were
-- live and could not seed toward them — the guide's own split ("HR and the
-- sales tiles arrive with their domains (PR-3/PR-4) and get curated rows
-- there"), and this is that row.
--
-- WHY A NEW FILE AND NOT AN EDIT TO 9023. The migrator's ledger is
-- `schema_migration(scope, filename)` — it keys on the FILENAME, so an edit
-- to the already-applied 9023 would never re-run, and the HR row would exist
-- on fresh tenants only. A new 90xx seed runs everywhere 9023 already ran and
-- everywhere it has yet to run. Numbered 9024 to state the dependency: it
-- runs immediately after 9023's curated rows, and it needs the same
-- prerequisites (role + permission populated by 9020/9021, which is why this
-- is a 90xx tenant seed and not a block inside a tenant migration — role and
-- permission are empty when tenant migrations run).
--
-- THE SHAPE IS 9023'S, AND SO IS THE PROMISE. The seed is data-driven: it
-- intersects the curated HR band with the modules the HR role can actually
-- READ, so it cannot promise a tile the eligibility resolver would
-- immediately hide. A tenant that revoked, say, MOD-11 from HR gets a
-- three-tile default, not a seeded lie. scope_ids stays NULL (dynamic —
-- everything the role can read becomes pickable the day its tile ships, with
-- nobody editing rows), default_ids is the guide §7.2 curated four, nothing
-- is locked.
--
-- Payroll (payroll_run_state) and attrition (attrition_90d) are deliberately
-- NOT in the default four: they are pickable by anyone who can read MOD-17 /
-- MOD-02 (and payroll_run_state additionally requires employee.salary not be
-- masked — §4.3 — which is a role-config decision the seed must not
-- second-guess), but the band an HR officer opens every morning is the
-- people-operations one.
--
-- Idempotent: ON CONFLICT (role_id) DO NOTHING — a tenant that has already
-- configured the HR role keeps its own arrays.
-- ============================================================================

WITH tile(tile_id, module_key) AS (
  VALUES
    ('headcount',        'MOD-02'),
    ('attendance_today', 'MOD-14'),
    ('leave_pending',    'MOD-15'),
    ('vacancies_open',   'MOD-11')
), curated(role_code, tile_ids) AS (
  VALUES
    ('HR', ARRAY['headcount','attendance_today','leave_pending','vacancies_open'])
), eligible AS (
  -- The read-time rule, evaluated at seed time (same CTE as 9023): a tile is
  -- eligible for a role when the role can read the tile's module.
  SELECT r.role_id, t.tile_id
  FROM role r
  JOIN tile t ON true
  WHERE r.is_system = true
    AND r.code = 'HR'
    AND EXISTS (
      SELECT 1 FROM permission p
      WHERE p.role_id = r.role_id AND p.module_key = t.module_key AND p.can_read = true
    )
)
INSERT INTO role_kpi_config (role_id, scope_ids, default_ids, locked_ids)
SELECT
  r.role_id,
  NULL,                                   -- scope = dynamic (everything readable)
  (SELECT array_agg(q.tile_id ORDER BY q.ord)
     FROM unnest(c.tile_ids) WITH ORDINALITY AS q(tile_id, ord)
     JOIN eligible e ON e.tile_id = q.tile_id AND e.role_id = r.role_id),
  '{}'
FROM role r
JOIN curated c ON c.role_code = r.code
WHERE EXISTS (
  SELECT 1
    FROM unnest(c.tile_ids) AS q(tile_id)
    JOIN eligible e ON e.tile_id = q.tile_id AND e.role_id = r.role_id
)
ON CONFLICT (role_id) DO NOTHING;

-- DOWN
-- Presentation defaults only — no authority is granted here, and clearing the
-- row returns the role to the system band rather than removing access. Deletes
-- only the row this seed can have written (dynamic scope, nothing locked), so
-- a tenant's own HR configuration survives.
--
--   DELETE FROM role_kpi_config
--    WHERE scope_ids IS NULL AND locked_ids = '{}'
--      AND role_id IN (SELECT role_id FROM role
--                       WHERE is_system = true AND code = 'HR');
