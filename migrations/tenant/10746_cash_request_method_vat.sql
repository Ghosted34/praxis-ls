-- ============================================================================
-- TENANT DB — 10746 Cash request: disbursement method + per-line VAT and
-- justification flag (§3.5).
--
-- Legacy view/admin/cash-request.php carries a disbursement METHOD — CASH /
-- BANK / CHEQUE / MOMO (:499) — each with method-specific required fields
-- validated at :505-514 (BANK → bank name, account number, account name;
-- MOMO → MoMo number + network MTN/ORANGE; CHEQUE → cheque number). Ours had
-- none of it, so Finance approved money with no idea how it was to leave the
-- company. The method lands as a checked text column; its fields land as ONE
-- jsonb (they are display/void-check data for the voucher, not join keys —
-- three nullable columns per method would be nine columns that are null for
-- three quarters of rows). The per-method required-field rule is enforced in
-- the service so it holds for every caller, and the method becomes REQUIRED
-- at submission — a request Finance cannot pay out is not ready for Finance.
--
-- Per line, legacy carries a VAT %% and a "Just. Req?" checkbox and totals
-- the sheet Subtotal / VAT / TOTAL PAYABLE. cash_request_line (0342) had
-- budget_amount / spent_amount / is_debours / proof_vault_id and nothing
-- else, so the payable total was silently HT.
-- ============================================================================

ALTER TABLE cash_request
  ADD COLUMN IF NOT EXISTS disbursement_method text,
  ADD COLUMN IF NOT EXISTS disbursement_details jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Named CHECK under a DO guard (style: 0671_dossier_draft.sql:48). NULL is
-- legal while DRAFT; the service requires a method at SUBMITTED.
ALTER TABLE cash_request
  DROP CONSTRAINT IF EXISTS cash_request_disbursement_method_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'cash_request_disbursement_method_check') THEN
    ALTER TABLE cash_request ADD CONSTRAINT cash_request_disbursement_method_check
      CHECK (disbursement_method IS NULL OR disbursement_method IN ('CASH','BANK','CHEQUE','MOMO'));
  END IF;
END $$;

COMMENT ON COLUMN cash_request.disbursement_method IS
  'How the money leaves: CASH | BANK | CHEQUE | MOMO (legacy :499). NULL while DRAFT; required at submission.';
COMMENT ON COLUMN cash_request.disbursement_details IS
  'Method-specific fields (legacy :505-514): BANK {bank_name, account_number, account_name}; MOMO {momo_number, network MTN|ORANGE}; CHEQUE {cheque_number}. Shape enforced by the service per method.';

ALTER TABLE cash_request_line
  ADD COLUMN IF NOT EXISTS vat_percent numeric(9,4),
  ADD COLUMN IF NOT EXISTS justification_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cash_request_line.vat_percent IS
  'Legacy per-line VAT %%. NULL = no VAT. Feeds the voucher''s Subtotal / VAT / TOTAL PAYABLE.';
COMMENT ON COLUMN cash_request_line.justification_required IS
  'Legacy "Just. Req?" — this line''s spend must come back with a receipt at justification time.';

-- DOWN
-- Additive only; reversible with no data loss.
--
--   ALTER TABLE cash_request_line
--     DROP COLUMN IF EXISTS justification_required,
--     DROP COLUMN IF EXISTS vat_percent;
--   ALTER TABLE cash_request
--     DROP CONSTRAINT IF EXISTS cash_request_disbursement_method_check;
--   ALTER TABLE cash_request
--     DROP COLUMN IF EXISTS disbursement_details,
--     DROP COLUMN IF EXISTS disbursement_method;
