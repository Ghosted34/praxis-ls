-- ============================================================================
-- TENANT DB — 10744 Costing worksheet gaps (§3.3): remarks + validator
-- assignment timestamp.
--
-- Legacy api/costing/save.php persists `remarks` (:29) and
-- `validator_employee_id` + `validator_assigned_at` (:6,:33). Our costing
-- table (0320) had validator_id but no remarks column and no record of WHEN a
-- validator was named — so the worksheet could not carry the note the ops
-- clerk writes for the validator, and a costing could sit "submitted for
-- validation" with no way to tell how long the named validator had been
-- sitting on it.
-- ============================================================================

ALTER TABLE costing
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS validator_assigned_at timestamptz;

COMMENT ON COLUMN costing.remarks IS
  'Worksheet notes (legacy save.php:29) — context for the validator/approver; prints on the costing document.';
COMMENT ON COLUMN costing.validator_assigned_at IS
  'When validator_id was named (legacy validator_assigned_at). Stamped by the service whenever validator_id is set.';

-- DOWN
-- Additive only; reversible with no data loss.
--
--   ALTER TABLE costing
--     DROP COLUMN IF EXISTS validator_assigned_at,
--     DROP COLUMN IF EXISTS remarks;
