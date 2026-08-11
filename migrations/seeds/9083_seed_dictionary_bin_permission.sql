-- ============================================================================
-- SEED (per tenant schema) — 9083 the permission that gates the dictionary bin.
--
-- WHY A SEPARATE MODULE KEY AND NOT can_delete ON MOD-05
--
-- `permission` is UNIQUE (role_id, module_key), so MOD-05 carries exactly one
-- CRUD row per role and its can_delete is already spoken for: it is what lets
-- ACCOUNTANT and SUPER_ADMIN maintain the catalogue day to day. Reusing it
-- would mean anyone who can edit a dictionary item can also remove one, which
-- is precisely the conflation this gate exists to prevent — editing a label is
-- routine, removing a line from every picker in the company is not.
--
-- MOD-05B is therefore its own capability:
--
--   can_delete  send an item to the recycle bin, and RETIRE one that is
--               already used on a document (0641's escape hatch)
--   can_update  restore an item from the bin before its 14 days elapse
--   can_read    see the bin at all
--
-- WHO GETS IT. Deliberately narrower than MOD-05. SUPER_ADMIN and ACCOUNTANT
-- only: the catalogue is the accounting team's instrument, and a removal
-- silently changes what every future quote, costing sheet and invoice can say.
-- SALES and OPERATIONS keep their MOD-05 read access and get nothing here —
-- absence of a row is absence of access, which is the convention 9021 sets.
-- Tenants widen this from the Super Admin permission screen if they want to.
--
-- The CEO bypasses RBAC entirely and needs no row, same as everywhere else.
--
-- NOTE ON THE CATALOGUE. platform.module_catalogue lives in the PLATFORM
-- database and is seeded by the 91xx series; permission.module_key is a plain
-- citext with no cross-database FK, so this grant stands on its own. The
-- catalogue entry is added in 9113 so the module appears by name in the
-- company dashboard's per-tenant module switches.
-- ============================================================================

INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, 'MOD-05B', v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', false, true, true, true, false),
             ('ACCOUNTANT',  false, true, true, true, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
ON CONFLICT (role_id, module_key) DO NOTHING;

-- can_create is false for both, and that is not an oversight: nothing is ever
-- created in the recycle bin. Items arrive by being removed from the catalogue
-- (MOD-05 can_delete is not what does it — bin_dictionary_item is), and leave
-- by restore or by the purge timer.

-- DOWN
-- DELETE FROM permission WHERE module_key = 'MOD-05B';
