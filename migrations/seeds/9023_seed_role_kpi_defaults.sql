-- ============================================================================
-- SEED (per tenant schema) — 9023 the curated Control Tower band, per role.
--
-- Companion to doc/KPI_BAND_ENGINEERING_GUIDE.md §7.2 and to the table created
-- in migrations/tenant/13800_role_kpi_config.sql. Three arrays per role:
--
--   scope_ids    which catalog ids this role's PEOPLE may pick from at all.
--                NULL (the default, and what this seed writes) means
--                "everything the role can read", recomputed at every read — so
--                a tile that ships in a later PR becomes pickable for the role
--                the day it goes live, with nobody editing rows. A non-null
--                array narrows it, which is how "warehouse operators never see
--                margin" is said.
--   default_ids  the band a member sees before they touch a picker. ≤ 4 — the
--                fixed-four promise (D2), enforced by a CHECK in 13800.
--   locked_ids   slots every member must carry. ⊆ default_ids.
--
-- WHY THIS IS A 90xx SEED AND NOT PART OF 13800.
--
-- The seed is data-driven: it intersects a curated band with the modules the
-- role can actually READ, so it can never promise a tile the eligibility
-- resolver would immediately hide (a seeded lie on day one is worse than no
-- seed). That intersection needs `role` and `permission` to have rows.
--
-- On a fresh tenant they do not have rows when 13800 runs.
-- `provisioning.service.js → migrateTenantDb` applies every tenant migration
-- first and only then the 90xx seeds, and the roles themselves arrive in
-- 9020/9021/9022. The same block therefore inserts NOTHING on a new tenant and
-- SOMETHING on an existing one — one migration set, two different tenants.
-- Moving it here makes both orders produce the same rows, which is the whole
-- claim of the ledger.
--
-- 90xx = tenant seed (migrator.files.tenantSeeds, /^90/), applied per schema
-- (live + sandbox). `role_kpi_config` is a TENANT table, so a 91xx number would
-- run this against the platform DB and fail. Numbered 9023 to state the
-- dependency: it runs immediately after 9021/9022 have granted the permissions
-- it reads.
--
-- WHY ids ARE BARE TEXT AND NOT AN FK. The catalog is code (guide §4: a
-- tenant-editable catalog is a fake number waiting to be configured). The CHECK
-- constraints in 13800 enforce arity and containment — shape, which SQL is good
-- at — and `role_kpi.service.js` validates membership against the code catalog
-- on every write. Ids that stop existing fail CLOSED: the resolver filters
-- before it paints, so an orphan id never renders and never grants anything.
--
-- Roles with no curated row (ACCOUNTANT, PROCUREMENT, SUPER_ADMIN, …) fall
-- through to the system default of today's four; HR and the sales tiles arrive
-- with their domains (PR-3/PR-4) and get curated rows there.
--
-- Idempotent: ON CONFLICT (role_id) DO NOTHING, so re-running changes nothing
-- and a tenant that has already configured a role keeps its own arrays.
-- ============================================================================

WITH tile(tile_id, module_key) AS (
  VALUES
    ('revenue',             'MOD-51'),
    ('receivables_overdue', 'MOD-52'),
    ('proformas_open',      'MOD-50'),
    ('journals_unposted',   'MOD-55'),
    ('files_active',        'MOD-29'),
    ('sla_on_time',         'MOD-29'),
    ('approvals_awaiting',  'MOD-00A'),
    ('compliance_open',     'MOD-65'),
    ('needs_location',      'MOD-00A'),
    ('fleet_utilisation',   'MOD-39')
),
curated(role_code, tile_ids) AS (
  VALUES
    ('FINANCE',    ARRAY['revenue','receivables_overdue','proformas_open','journals_unposted']),
    ('OPERATIONS', ARRAY['files_active','sla_on_time','needs_location','approvals_awaiting']),
    ('FLEET',      ARRAY['fleet_utilisation','files_active','needs_location','approvals_awaiting']),
    ('WAREHOUSE',  ARRAY['files_active','compliance_open','needs_location','approvals_awaiting']),
    ('SALES',      ARRAY['revenue','receivables_overdue','proformas_open','files_active']),
    ('CEO',        ARRAY['revenue','receivables_overdue','sla_on_time','files_active']),
    ('MANAGEMENT', ARRAY['revenue','receivables_overdue','sla_on_time','files_active'])
),
eligible AS (
  -- The read-time rule, evaluated at seed time: a tile is eligible for a role
  -- when the role can read the tile's module — or is the CEO, for whom
  -- requirePermission bypasses the matrix (rbac.js); an eligible-set that
  -- ignored that would hand the CEO a picker narrower than their own band.
  SELECT r.role_id, t.tile_id
  FROM role r
  JOIN tile t ON true
  WHERE r.is_system = true
    AND (
      r.code = 'CEO'
      OR EXISTS (
        SELECT 1 FROM permission p
        WHERE p.role_id = r.role_id AND p.module_key = t.module_key AND p.can_read = true
      )
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
-- Presentation defaults only — no authority is granted here, and clearing a
-- row returns the role to the system band rather than removing access. Deletes
-- only the rows this seed can have written (dynamic scope, nothing locked), so
-- a tenant's own configuration survives.
--
--   DELETE FROM role_kpi_config
--    WHERE scope_ids IS NULL AND locked_ids = '{}'
--      AND role_id IN (SELECT role_id FROM role
--                       WHERE is_system = true
--                         AND code IN ('FINANCE','OPERATIONS','FLEET',
--                                      'WAREHOUSE','SALES','CEO','MANAGEMENT'));
