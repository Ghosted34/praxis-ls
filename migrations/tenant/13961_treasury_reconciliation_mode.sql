-- Add reconciliation_mode to treasury_category (Audit #10)
-- Modes: BANK_STATEMENT, CASH_COUNT, MOMO_STATEMENT, OTHER_EXTERNAL_STATEMENT
-- Note: Mode values validated at application layer (validator/service)
-- per migration constraint ordering rules for pre-existing tables.

ALTER TABLE treasury_category
  ADD COLUMN IF NOT EXISTS reconciliation_mode text NOT NULL DEFAULT 'BANK_STATEMENT';

UPDATE treasury_category
   SET reconciliation_mode = 'CASH_COUNT'
 WHERE code IN ('CASH', 'PETTY_CASH') OR requires_custodian = true;

UPDATE treasury_category
   SET reconciliation_mode = 'MOMO_STATEMENT'
 WHERE code IN ('MTN_MOMO', 'ORANGE_MONEY') OR is_momo_identity = true;

-- DOWN
-- ALTER TABLE treasury_category DROP COLUMN IF EXISTS reconciliation_mode;
