-- ============================================================================
-- TENANT — 14100 The Test permission right
-- (doc/SMART_COMMS_CALLS_AUDIT.md, PR-7; owner decision O5).
--
-- A ninth right beside Read, Create, Update, Delete, Approve, Validate,
-- Disburse and Export. Holding it on Smart Comms (MOD-64) lets a person run
-- the call-pipeline test from Comms → Setup → Test calls, which spends
-- provider credit — so, unlike 12771's three rights, it is NOT backfilled from
-- anything: no role holds Test until an administrator grants it. The CEO passes
-- it through the bypass in middleware/rbac.js, like every right (PRD §3).
--
-- Plain column, NOT NULL with a constant default: no constraint to order
-- (tests/unit/migration-constraint-ordering.test.js).
-- ============================================================================

ALTER TABLE permission
  ADD COLUMN IF NOT EXISTS can_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN permission.can_test IS
  'May run live checks that spend provider credit (on MOD-64: Comms → Setup → Test calls). Held by no role by default; granted explicitly (calls audit O5).';

-- ============================================================================
-- DOWN
--   ALTER TABLE permission DROP COLUMN IF EXISTS can_test;
-- ============================================================================
