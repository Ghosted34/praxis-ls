-- ============================================================================
-- TENANT DB — 10740 OCR reconciliation: HT not TTC, and débours out of the
-- variance base (BUG-2, BUG-3).
--
-- BUG-2 — THE COLUMNS WERE NAMED *_ttc BUT HELD HT.
--
-- dossier_reconciliation_line.budget_ttc / actual_ttc (10715:45) were populated
-- by `SUM(cl.qty * cl.unit_cost)` and `SUM(cost_entry.amount)`. costing_line.unit_cost
-- is the HT unit price — VAT lives on costing_line.tax_code_id (0320:29), and
-- cost_entry.amount is the posted HT amount. So the value stored was HT while
-- the column name promised TTC. Sooner or later someone adds VAT to a number
-- that is already supposed to include it. The columns are renamed to the value
-- they actually hold (budget_ht / actual_ht). Genuinely computing TTC was
-- rejected: it would require deriving VAT per line from tax_code_id just to
-- rename a column, and reconciliation compares cost bases that are HT end to
-- end (quotation.total_ht, not total_ttc — 0345:18).
--
-- No backfill. BUG-1 (10718 status mismatch) meant the budget subquery matched
-- zero rows for every reconciliation ever written, so no stored budget_ht is
-- correct; renaming in place loses nothing true.
--
-- BUG-3 — DÉBOURS WERE NOT EXCLUDED FROM THE VARIANCE BASE.
--
-- OHADA_KB.md:450 — débours are pass-through: neither revenue nor cost, and
-- excluded from the margin. The reconciliation query summed every costing line
-- and every cost entry regardless of the item's disbursement flag, so a file
-- heavy in customs/port débours showed a variance that moved with money the
-- forwarder never earned or spent. The line table gains is_disbursement so the
-- per-line row carries the fact, and the operational totals split service
-- (margin-bearing) from disbursement (pass-through).
--
-- The flag is taken from dictionary_item.is_disbursement (renamed from is_debours
-- by 0640), which is the same source costing_line.is_disbursement is set from
-- and which assert_line_valid() enforces for the ledger. cost_entry has no flag
-- of its own; it joins dictionary_item. A cost entry with no dictionary item is
-- an own-cost (the disbursement posting path always names the item), so it is
-- treated as non-disbursement.
--
-- ADDITIVE / RENAME ONLY. No column is dropped or retyped; renaming rewrites no
-- data. The new boolean is defaulted false so existing rows stay valid.
-- ============================================================================

-- BUG-2: the columns hold HT; name them for what they hold. Guarded so this is
-- idempotent on a tenant where the names already exist (check-migration-idempotency).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'dossier_reconciliation_line'
                AND column_name = 'budget_ttc')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'dossier_reconciliation_line'
                AND column_name = 'budget_ht') THEN
    ALTER TABLE dossier_reconciliation_line RENAME COLUMN budget_ttc TO budget_ht;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'dossier_reconciliation_line'
                AND column_name = 'actual_ttc')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'dossier_reconciliation_line'
                AND column_name = 'actual_ht') THEN
    ALTER TABLE dossier_reconciliation_line RENAME COLUMN actual_ttc TO actual_ht;
  END IF;
END $$;

-- BUG-3: carry the disbursement fact on the line so the variance base can
-- exclude it without a second join at read time.
ALTER TABLE dossier_reconciliation_line
  ADD COLUMN IF NOT EXISTS is_disbursement boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN dossier_reconciliation_line.budget_ht IS
  'Approved costing line spend for this item, HT. Renamed from budget_ttc in 10740 — the value was always HT (VAT lives on tax_code_id); the old name lied.';
COMMENT ON COLUMN dossier_reconciliation_line.actual_ht IS
  'Posted actual cost for this item, HT. Renamed from actual_ttc in 10740.';
COMMENT ON COLUMN dossier_reconciliation_line.is_disbursement IS
  'Débours/pass-through for this dictionary item. Excluded from the service cost variance and margin; reported as a separate pass-through total.';

-- DOWN
-- Rename-only + one defaulted boolean; reversible with no data loss.
--
--   ALTER TABLE dossier_reconciliation_line
--     DROP COLUMN IF EXISTS is_disbursement;
--   -- Restore the mislabels (the columns held HT under either name):
--   ALTER TABLE dossier_reconciliation_line RENAME COLUMN actual_ht TO actual_ttc;
--   ALTER TABLE dossier_reconciliation_line RENAME COLUMN budget_ht TO budget_ttc;
