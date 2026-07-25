-- ============================================================================
-- 0463 — cost_entry.source_ref (idempotency key for orchestrated analytical costs)
-- Orchestration handlers that attribute a cost to a dossier WITHOUT a fresh GL
-- posting (driver time already in payroll's 661, WMS handling, etc.) need a stable
-- key to avoid double-attribution on at-least-once redelivery. `source_ref` holds
-- the originating doc (e.g. 'fleet_dispatch:<id>'); a partial UNIQUE index enforces
-- one analytical cost_entry per source. Existing GL-linked cost_entries leave it
-- NULL (they dedupe on entry_id) and are unaffected.
-- ============================================================================

ALTER TABLE cost_entry ADD COLUMN IF NOT EXISTS source_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cost_entry_source_ref
  ON cost_entry(source_ref) WHERE source_ref IS NOT NULL;
