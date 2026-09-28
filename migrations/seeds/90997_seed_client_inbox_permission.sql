-- ============================================================================
-- SEED (per tenant schema) — 90997 the permission behind the Client inbox
-- (MOD-64C, client portal redesign PR 3). The catalogue half is 9136.
--
-- WHY A MODULE KEY OF ITS OWN
--
-- Until now the staff side of the client chat was gated on MOD-67 — the IAM /
-- RBAC engine — because that was the key the client-support screen happened to
-- sit under. Its grants are an ADMINISTRATOR's (9021: SUPER_ADMIN writes, CEO
-- and MANAGEMENT read), so the people who actually answer clients — sales and
-- operations — could not read a client's message, let alone reply, and a
-- client writing "where is my container?" reached the IT administrator. MOD-64
-- (Smart Comms) is no better a fit: its update right is held by six
-- departments, warehouse and HR among them, and a client's conversation is not
-- theirs to read.
--
-- WHAT EACH COLUMN MEANS HERE
--
--   can_read    see the inbox and every client conversation in it
--   can_update  reply, mark read, and name a client's account manager
--
-- WHO GETS IT. Owner decision 2/12: a message nobody owns goes to operations
-- and to whoever holds this permission. So OPERATIONS and SALES answer (read
-- and update), MANAGEMENT oversees and can step in (read and update), and
-- SUPER_ADMIN carries the full row as everywhere. Absence of a row is absence
-- of access (the 9021 convention); a tenant widens this from the Super Admin
-- permission screen. The CEO bypasses RBAC and needs no row.
-- ============================================================================

INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, 'MOD-64C', v.c, v.r, v.u, v.d, v.a
FROM role r
JOIN (VALUES ('SUPER_ADMIN', true,  true, true, true,  false),
             ('MANAGEMENT',  false, true, true, false, false),
             ('SALES',       false, true, true, false, false),
             ('OPERATIONS',  false, true, true, false, false)
     ) AS v(role_code, c, r, u, d, a) ON v.role_code = r.code
ON CONFLICT (role_id, module_key) DO NOTHING;

-- DOWN
-- DELETE FROM permission WHERE module_key = 'MOD-64C';
