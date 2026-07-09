-- ============================================================================
-- SEED (per tenant schema) — default role x module CRUD grants (MOD-67).
-- Closes the WORK_TO_BE_DONE.md "next real blocker": zero `permission` rows
-- were seeded for any of the 11 default roles, so a freshly provisioned
-- tenant had nobody but the RBAC-bypassing CEO who could do anything.
--
-- Source: doc/SmartLS_SuperAdmin_User_Journey_and_RBAC.docx's 18-row
-- role x module-group access matrix, mapped onto the 70 MOD-xx catalogue
-- codes (migrations/seeds/9100_seed_platform_catalogue.sql). Legend:
--   full (create/edit/delete)  -> can_create=t, can_read=t, can_update=t, can_delete=t
--   create/edit                -> can_create=t, can_read=t, can_update=t
--   view only                  -> can_read=t
--   approve                    -> can_read=t, can_approve=t
--   none                       -> no row (absence = no access, not a
--                                  false-filled row — the Super Admin's
--                                  `permission` screen is where a tenant
--                                  adds anything beyond this baseline)
--
-- Two matrix rows were deliberately NOT seeded here (decided with the
-- user, see doc/WORK_DONE.md):
--   - "AI & event engine": the only catalogue module_key it could target,
--     MOD-67, already carries a DIFFERENT, contradictory grant pattern for
--     "IAM & user access" below (permission has UNIQUE(role_id,
--     module_key) — can't seed both onto one key). MOD-67's grants below
--     are the IAM & user access pattern; AI gets nothing until AI work
--     starts for real and earns its own module_key via a migration.
--   - "Comms & portals admin": no module_key exists for it at all (no
--     comms/portal group_key in platform.module_catalogue; the one
--     candidate, MOD-64, is already claimed by "Document vault &
--     compliance" below with a materially different pattern). Revisit
--     once comms/portals get a real catalogue entry.
--
-- Two modules the matrix doesn't cover at all, seeded nowhere on purpose
-- (flagged, not silently guessed): MOD-00A (Dashboard & My Workspace),
-- MOD-63 (Reporting & Insights).
-- ============================================================================

-- Stop 4: Tenant / company setup -> MOD-70 (Settings)
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-70')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 5: IAM & user access -> MOD-67 (IAM/RBAC engine — role, capability,
-- scope, permission, field_visibility all share this one catalogue key),
-- MOD-68 (Session Management)
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO', false, true, false, false, true),
             ('MANAGEMENT', false, true, false, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-67'), ('MOD-68')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 6: Master data & dictionary -> corporate entities, client/supplier
-- master, financial dictionary, treasury accounts, expense rates
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', true, true, true, false, false),
             ('ACCOUNTANT', true, true, true, true, false),
             ('SALES', false, true, false, false, false),
             ('OPERATIONS', false, true, false, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-01'), ('MOD-03'), ('MOD-04'), ('MOD-05'), ('MOD-09'), ('MOD-10')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 6 (cont'd): Chart of accounts / tax jurisdiction / currency & FX —
-- split from the row above because Sales/Ops lose visibility here
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', true, true, true, false, false),
             ('ACCOUNTANT', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-06'), ('MOD-07'), ('MOD-08')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 7: HR & payroll (employees + the full HR module group)
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', false, true, false, false, false),
             ('HR', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-02'), ('MOD-11'), ('MOD-12'), ('MOD-13'), ('MOD-14'), ('MOD-15'),
                    ('MOD-16'), ('MOD-17'), ('MOD-18'), ('MOD-19')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 8: Sales & CRM
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, true),
             ('FINANCE', false, true, false, false, false),
             ('SALES', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-20'), ('MOD-21'), ('MOD-22'), ('MOD-23'), ('MOD-24'), ('MOD-25'), ('MOD-26')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 9: Commercial / pricing simulators
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, true),
             ('FINANCE', false, true, false, false, true),
             ('SALES', true, true, true, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-27'), ('MOD-28')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 10: Operations (dossier, transit order, milestones, delivery note)
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', false, true, false, false, false),
             ('OPERATIONS', true, true, true, true, false),
             ('WAREHOUSE', false, true, false, false, false),
             ('FLEET', false, true, false, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-29'), ('MOD-30'), ('MOD-31'), ('MOD-32')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 11: Warehouse (WMS)
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('OPERATIONS', false, true, false, false, false),
             ('WAREHOUSE', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-33'), ('MOD-34'), ('MOD-35'), ('MOD-36'), ('MOD-37'), ('MOD-38')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 12: Fleet
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', false, true, false, false, false),
             ('OPERATIONS', false, true, false, false, false),
             ('FLEET', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-39'), ('MOD-40'), ('MOD-41'), ('MOD-42'), ('MOD-43'), ('MOD-44'), ('MOD-45')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 13: Ops costing
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, true),
             ('FINANCE', true, true, true, true, false),
             ('ACCOUNTANT', false, true, false, false, false),
             ('OPERATIONS', true, true, true, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-46'), ('MOD-47'), ('MOD-48'), ('MOD-49')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 14: Finance & treasury
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, true),
             ('MANAGEMENT', false, true, false, false, true),
             ('FINANCE', true, true, true, true, false),
             ('ACCOUNTANT', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-50'), ('MOD-51'), ('MOD-52'), ('MOD-53'), ('MOD-54')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 15: The books — accounting / GL / statutory statements
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', false, true, false, false, false),
             ('ACCOUNTANT', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-55'), ('MOD-56'), ('MOD-57'), ('MOD-58'), ('MOD-59')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 17: Procurement
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, true),
             ('FINANCE', false, true, false, false, true),
             ('OPERATIONS', false, true, false, false, false),
             ('WAREHOUSE', false, true, false, false, false),
             ('PROCUREMENT', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-60'), ('MOD-61'), ('MOD-62')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 18: Document vault, compliance checker & QR — every role gets at
-- least create/edit on their own department's documents
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO', false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE', false, true, false, false, false),
             ('ACCOUNTANT', false, true, false, false, false),
             ('SALES', true, true, true, false, false),
             ('OPERATIONS', true, true, true, false, false),
             ('WAREHOUSE', true, true, true, false, false),
             ('FLEET', true, true, true, false, false),
             ('PROCUREMENT', true, true, true, false, false),
             ('HR', true, true, true, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-64'), ('MOD-65'), ('MOD-66')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Stop 22: Security, the immutable ledger & God Mode — everyday audit
-- trail is Super-Admin view-only; only the CEO can purge (godmode.service.js
-- separately PIN-gates the purge action itself — this grant just governs
-- API access to the ledger/soft-delete/restore/purge endpoints)
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, m.module_key, v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, false, false, false),
             ('CEO', true, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
CROSS JOIN (VALUES ('MOD-69'), ('MOD-00B')) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;
