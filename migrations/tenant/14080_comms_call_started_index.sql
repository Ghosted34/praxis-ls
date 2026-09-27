-- ============================================================================
-- TENANT — 14080 Smart Comms calls at scale (doc/SMART_COMMS_CALLS_AUDIT.md,
-- PR-5, audit D4).
--
-- The metrics aggregation reads `comms_call WHERE started_at >= $1`. 14020
-- said `ix_comms_call_group (group_id, started_at DESC)` serves that read; it
-- cannot, because its leading column is group_id, so the read was a full scan
-- of every call the tenant ever made. This index serves it.
--
-- An index is not a constraint (tests/unit/migration-constraint-ordering.test.js).
-- Plain CREATE INDEX, not CONCURRENTLY: the migrator sends each file as one
-- transaction block (see 0504).
-- ============================================================================

CREATE INDEX IF NOT EXISTS ix_comms_call_started ON comms_call (started_at);

COMMENT ON INDEX ix_comms_call_started IS
  'Serves the call metrics aggregation (started_at >= $1). ix_comms_call_group does not: its leading column is group_id (audit D4).';

-- ============================================================================
-- VERIFY
--   EXPLAIN SELECT count(*) FROM comms_call WHERE started_at >= now() - interval '7 days';
--   -- Index (Only) Scan / Bitmap Index Scan using ix_comms_call_started
--
-- DOWN
--   DROP INDEX IF EXISTS ix_comms_call_started;
-- ============================================================================
