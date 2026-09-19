-- Add reconciliation_mode to treasury_category (Audit #10)
-- Modes: BANK_STATEMENT, CASH_COUNT, MOMO_STATEMENT, OTHER_EXTERNAL_STATEMENT

ALTER TABLE treasury_category
  ADD COLUMN IF NOT EXISTS reconciliation_mode text NOT NULL DEFAULT 'BANK_STATEMENT'
  CHECK (reconciliation_mode IN ('BANK_STATEMENT', 'CASH_COUNT', 'MOMO_STATEMENT', 'OTHER_EXTERNAL_STATEMENT'));

UPDATE treasury_category
   SET reconciliation_mode = 'CASH_COUNT'
 WHERE code IN ('CASH', 'PETTY_CASH') OR requires_custodian = true;

UPDATE treasury_category
   SET reconciliation_mode = 'MOMO_STATEMENT'
 WHERE code IN ('MTN_MOMO', 'ORANGE_MONEY') OR is_momo_identity = true;

-- DOWN
-- ALTER TABLE treasury_category DROP COLUMN IF EXISTS reconciliation_mode;
