-- ============================================================================
-- TENANT DB — 0521 Section senders become DYNAMIC + archivable.
--
-- `email_identity.purpose` was a hardcoded CHECK of four values
-- (BILLING/DOCUMENTS/NOTIFICATIONS/SUPPORT). Section senders are now
-- tenant-defined: a tenant may add any labelled sender, not only those four.
-- The CHECK is dropped so an arbitrary section label can be saved (the request
-- validator already accepts any string up to 64 chars).
--
-- `archived_at` gives a sender a soft ARCHIVE (hidden from the list, not
-- deleted) — distinct from the existing `is_active` on/off toggle.
--
-- Additive + idempotent (DROP … IF EXISTS / ADD COLUMN IF NOT EXISTS), no data
-- rewrite. See doc/INTEGRATION_PLAN.md WS-E3.
-- ============================================================================

ALTER TABLE email_identity DROP CONSTRAINT IF EXISTS email_identity_purpose_check;
ALTER TABLE email_identity ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- DOWN: If we ever need to roll back, we can restore the CHECK and drop the column.
-- ALTER TABLE email_identity ADD CONSTRAINT email_identity_purpose_check CHECK (purpose IN ('BILLING', 'DOCUMENTS', 'NOTIFICATIONS', 'SUPPORT'));
-- ALTER TABLE email_identity DROP COLUMN IF EXISTS archived_at;