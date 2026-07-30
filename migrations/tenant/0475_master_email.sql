-- Recipient email on the party masters so documents (invoices, POs, payslips,
-- contracts…) can be sent without typing the address each time. Nullable —
-- existing rows keep working; the Send flow falls back to a typed address.
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS email citext;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS email citext;
ALTER TABLE employee        ADD COLUMN IF NOT EXISTS email citext;
