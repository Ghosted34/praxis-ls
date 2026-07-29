-- ============================================================================
-- 0470 — regie_advance.doc_number (persist the allocated régie number)
-- The régie service allocates a human document number at issue time but never
-- wrote it to the row, so the UI could only show a truncated id. Add doc_number
-- (same shape as costing / cash_request / purchase_*) so the issued number is
-- persisted and can be surfaced. Existing rows stay NULL and fall back to the
-- short id in the UI. Additive + idempotent.
-- ============================================================================

ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS doc_number text;
