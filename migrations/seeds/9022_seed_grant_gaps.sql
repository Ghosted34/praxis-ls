-- ============================================================================
-- SEED (per tenant schema) — default grants for the four module keys that are
-- catalogued and route-gated but have no `permission` row for any role, so on a
-- freshly provisioned tenant only the RBAC-bypassing CEO can reach them.
--
-- 90xx = tenant seed (migrator.files.tenantSeeds), applied per schema
-- (live + sandbox). Runs after 9021_seed_default_permissions.sql, which this
-- extends rather than edits — 9021 is applied everywhere and the migrator keys
-- on filename, so changing it in place would never re-run.
--
-- Source: doc/ORGANOGRAMME_AUDIT_2026-08-02.md findings C3, C4 and the C1
-- correction. Legend matches 9021: absence = no access, not a false-filled row.
--
--   MOD-00A  Dashboard & My Workspace   dashboard.routes.js:10-13 gates
--            GET /dashboard, /dashboard/kpis and /dashboard/control-tower on
--            view. 9021:33-35 deliberately seeded nothing ("the matrix doesn't
--            cover it"), which is defensible for an unknown module and severe
--            for this one: it is the app's home screen. Every non-CEO user
--            currently lands on a 403 after sign-in. Read for every role.
--
--   MOD-63   Reporting & Insights       report.routes.js:12-18. Same omission,
--            same cause. Read for every role; create/delete (saved reports and
--            dashboard tiles) for the roles that curate them.
--
--   MOD-71   HR Discipline              9120_hr_discipline_module.sql catalogued
--            the key correctly, but no default grant was ever seeded, so
--            /hr/queries and /hr/sanctions are CEO-only in practice. HR owns
--            discipline; MANAGEMENT sees it; nobody else does — sanctions are
--            personnel data. NB the self-service routes (/hr/queries/mine,
--            /hr/sanctions/mine and the respond endpoint) are deliberately
--            ungated in hr_query.routes.js:21-23 and unaffected: you always see
--            and answer your own.
--
--   MOD-72   Mail & Correspondence      new key, catalogued in 9130. Reading the
--            client mailbox and sending as the company is not a general staff
--            capability: SUPER_ADMIN administers connections, MANAGEMENT and
--            SALES correspond with clients, CEO reads. Widen per tenant from the
--            permission matrix rather than widening this default.
--
-- Idempotent: ON CONFLICT (role_id, module_key) DO NOTHING, so re-running is
-- safe and a tenant that has already tuned these keeps its own grants.
-- ============================================================================

-- MOD-00A — the home dashboard. Read for everyone; there is no write surface.
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, 'MOD-00A', false, true, false, false, false
FROM role r
ON CONFLICT (role_id, module_key) DO NOTHING;

-- MOD-63 — reporting. Everyone reads; the curating roles save reports/tiles.
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, 'MOD-63', false, true, false, false, false
FROM role r
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO',         true, true, true, true, false),
             ('MANAGEMENT',  true, true, true, false, false),
             ('FINANCE',     true, true, true, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-63')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- MOD-71 — HR discipline. Personnel data: HR owns it, MANAGEMENT oversees it.
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('HR',          true,  true, true,  true,  false),
             ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO',         false, true, false, false, false),
             ('MANAGEMENT',  false, true, false, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-71')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- MOD-72 — mail. Deliberately narrow: this grant reads client correspondence
-- and sends as the company.
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true,  true, true,  true,  false),
             ('CEO',         false, true, false, false, false),
             ('MANAGEMENT',  true,  true, true,  false, false),
             ('SALES',       true,  true, true,  false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-72')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;
