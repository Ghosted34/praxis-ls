-- ============================================================================
-- TENANT DB — 12768 A rate behind a disbursement's VAT, and that VAT now
-- counts toward the budget.
--
-- WHAT CHANGED, AND WHY.
--
-- 12766 added `costing_line.upstream_vat_amount` as a pure DISCLOSURE: the
-- supplier's own VAT inside a débours gross, shown beside the line and kept out
-- of every total, because that tax is not ours to collect. That is the correct
-- rule for a fiscal INVOICE.
--
-- A costing is not an invoice. It is the operations officer's BUDGET — what the
-- file will cost us in cash — and it posts nothing to the ledger. On that
-- document the money we hand the carrier for their VAT is money we will spend,
-- so the owner's decision is to budget it in: the débours VAT now enters the
-- VAT total and the TTC like any other line, and the sheet marks it (PT) plus a
-- remarks line so nobody mistakes the budget for a tax position.
--
-- Most débours carry the standard rate, and re-typing an amount per line is
-- both slow and a place for a typo to enter a figure that does not match the
-- rate. So a débours line now carries the RATE it was priced at; the amount is
-- derived from it (net × rate), and a free-text amount is the exception for the
-- rare supplier bill whose VAT is not a clean rate.
--
-- This is one nullable column. The existing `upstream_vat_amount` and its check
-- are unchanged — the amount is still where the money lives; the rate is only
-- what produced it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded constraint, so a re-run is a
-- no-op.
-- ============================================================================

ALTER TABLE costing_line
  ADD COLUMN IF NOT EXISTS upstream_vat_rate_percent numeric(9,4);

COMMENT ON COLUMN costing_line.upstream_vat_rate_percent IS
  'The VAT rate a disbursement line was priced at (default TVA_STD 19.25). The line''s upstream_vat_amount is derived from it (net x rate); NULL means the amount was entered by hand, or the line carries no VAT. Only ever set on a disbursement line.';

-- A rate belongs only to a disbursement, and only in a sane band. NOT VALID for
-- the same reason 12766's amount check is: rows predating the column cannot
-- violate it and need no rewrite to prove it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_costing_line_upstream_vat_rate') THEN
    ALTER TABLE costing_line
      ADD CONSTRAINT chk_costing_line_upstream_vat_rate
      CHECK (upstream_vat_rate_percent IS NULL
             OR (is_disbursement = true
                 AND upstream_vat_rate_percent >= 0
                 AND upstream_vat_rate_percent <= 100)) NOT VALID;
  END IF;
END $$;

-- ============================================================================
-- VERIFY
--   \d costing_line   -- expect column upstream_vat_rate_percent numeric(9,4)
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'chk_costing_line_upstream_vat_rate';   -- one row
--
-- DOWN
--   -- Non-destructive to drop: the amount column carries the money, so a
--   -- rolled-back rate loses only the record of which rate produced it.
--   -- ALTER TABLE costing_line DROP CONSTRAINT IF EXISTS chk_costing_line_upstream_vat_rate;
--   -- ALTER TABLE costing_line DROP COLUMN IF EXISTS upstream_vat_rate_percent;
-- ============================================================================
