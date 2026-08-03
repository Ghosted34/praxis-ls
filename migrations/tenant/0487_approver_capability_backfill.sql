-- ============================================================================
-- TENANT DB — 0487 APPROVER capability backfill (MOD-67)
-- requireCapability('APPROVER') is now mounted on the two highest-authority
-- costing routes (cash-request disburse MOD-49, costing status MOD-46). The gate
-- reads user_capability, which had no writer before this session, so without a
-- backfill every existing non-CEO approver on those routes would 403 with no way
-- to be granted the capability. This grants blanket APPROVER (document_type='*',
-- the wildcard requireCapability checks) to everyone who can already approve on
-- those modules via their roles — preserving current behaviour while the SoD
-- overlay becomes explicit and grantable (see capability.service.setForUser).
-- Idempotent + defensive (never blocks boot). CEO bypasses the gate regardless.
-- ============================================================================

DO $$
BEGIN
  INSERT INTO user_capability (user_id, capability_id, document_type)
  SELECT DISTINCT ur.user_id, c.capability_id, '*'
    FROM user_role ur
    JOIN permission p
      ON p.role_id = ur.role_id
     AND p.can_approve = true
     AND p.module_key IN ('MOD-46', 'MOD-49')
    JOIN capability c ON c.code = 'APPROVER'
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
