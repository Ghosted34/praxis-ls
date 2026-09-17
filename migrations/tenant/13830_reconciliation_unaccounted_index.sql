-- ============================================================================
-- TENANT DB — 13830 Budget Reconciliation: index the unaccounted spend tray.
--
-- Owner decision on guide §8.1, recorded 17/09/2026 — option B, "refuse at
-- settlement, surface in between": the five orchestration handlers keep
-- posting `cost_entry` rows no approved costing line carries (the ledger must
-- record what happened), and the sheet's "Unaccounted spend" tray is where
-- each one is mapped to a budget line — or the costing is amended to carry
-- the spend — before the file can be submitted.
--
-- The tray's read, on every GET of the sheet, is:
--
--   SELECT … FROM cost_entry
--    WHERE dossier_id = $1 AND costing_line_id IS NULL
--
-- The one relevant index that already exists does not help:
-- `ix_cost_entry_costing_line` (13801) is PARTIAL on
-- `costing_line_id IS NOT NULL` — the exact opposite of the tray's filter — so
-- the tray anchors on `dossier_id` instead, and this partial index is that
-- anchor: it covers precisely the rows the tray reads, and nothing else. The
-- common "nothing unaccounted" case is an empty index range, not a scan.
--
-- An index only. Nothing here touches the >13791 constraint rules (no CHECK,
-- no foreign key), and no table is altered.
-- ============================================================================

CREATE INDEX IF NOT EXISTS ix_cost_entry_unaccounted
  ON cost_entry (dossier_id) WHERE costing_line_id IS NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_cost_entry_unaccounted;
