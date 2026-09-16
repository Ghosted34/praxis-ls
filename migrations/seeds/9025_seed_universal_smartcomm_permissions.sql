-- ============================================================================
-- SEED (per tenant schema) — every staff role may use in-house SmartComms.
--
-- MOD-64 is the in-house messaging surface. Reading a channel is additionally
-- constrained by channel membership, and posting is additionally constrained
-- by the same membership check in smartcomm.service.js. RBAC should therefore
-- decide whether a staff member may use messaging at all, not accidentally
-- exclude whole departments such as Finance.
--
-- This intentionally grants only read + create:
--   read   lists the caller's channels/messages and manages their own state;
--   create posts messages and creates channels;
--   update/delete/approve remain role-specific administrative rights.
--
-- A new seed file (rather than editing 9021) upgrades existing tenants as well
-- as fresh tenants. OR-ing the two grants preserves every tenant's stronger
-- existing MOD-64 permissions and is safe to rerun.
-- ============================================================================

INSERT INTO permission (
  role_id, module_key,
  can_create, can_read, can_update, can_delete, can_approve
)
SELECT
  r.role_id, 'MOD-64',
  true, true, false, false, false
FROM role r
ON CONFLICT (role_id, module_key) DO UPDATE
SET can_create = permission.can_create OR EXCLUDED.can_create,
    can_read   = permission.can_read   OR EXCLUDED.can_read;

-- DOWN
--   No automatic down migration: an existing tenant may have independently
--   granted MOD-64 read/create. Removing those rights cannot safely distinguish
--   tenant policy from this baseline seed.
