-- ============================================================================
-- TENANT DB — 0442 credit notes. The invoice table already supports
-- type='CREDIT_NOTE'; this only adds the self-link back to the invoice a credit
-- note reverses, so the money path is traceable. See finance/credit_note.
-- ============================================================================
ALTER TABLE invoice ADD COLUMN IF NOT EXISTS reverses_invoice_id uuid REFERENCES invoice(invoice_id);
CREATE INDEX IF NOT EXISTS ix_invoice_reverses ON invoice(reverses_invoice_id);
