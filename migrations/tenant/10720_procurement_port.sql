-- ============================================================================
-- TENANT DB — 10720 procurement port (doc/PROCUREMENT_PORT_LEGACY_ANALYSIS.md)
--
-- Carries the legacy Finance & Treasury behaviour into the rebuild's
-- procurement module. Every column below is additive; nothing here changes an
-- existing row's meaning, so a tenant on 10719 applies it with no backfill.
--
-- WHAT THIS ADDS, AND WHY (each maps to a gap in the analysis doc):
--
--   1. purchase_order header enrichment (gap §6.1) — the legacy PO carried
--      currency, delivery date/location, payment means + pay days, a bank/MoMo
--      block, withholding (air_rate), advance paid, terms, remarks, due date,
--      HT/VAT/TTC, net payable and amount paid. The rebuild's PO had only
--      supplier/dossier/category/total_ttc, so the document could not print
--      what the legacy printed. `supplier_name`/`supplier_niu` are the
--      display snapshots captured at issue (same pattern as 0476 line labels
--      and the transit-order shipment snapshot) so a renamed supplier cannot
--      silently change an issued document.
--
--   2. purchase_order.entity_id — the PO never recorded which corporate entity
--      issued it; numbering and document branding had to be re-supplied on
--      every transition. Captured at issue.
--
--   3. purchase_order_item.tax_code_id — per-line VAT, so PO totals compute
--      HT / VAT / TTC instead of assuming 19.25%. Rates stay versioned rows
--      (0210), never literals; a line without a tax code is HT-only.
--
--   4. goods_received_note lines + document (gap §6.5) — the procurement GRN
--      was a header-only row (po_id, received_by, supplier_invoice_ref,
--      three_way_matched). This adds doc_number/entity/received_on/note and a
--      line table (ordered / received / condition), so a partial delivery can
--      be recorded and printed, and the three-way match can compare quantities.
--
--   5. supplier_invoice payment (gap §6.4) — the SI status CHECK had PAID
--      since 0342 but nothing could ever write it: no payment table, no pay
--      action, no Dr 4011 / Cr 521 posting. `supplier_invoice_payment` is the
--      record of each AP instalment (mirror of cash_request_payment, 10719),
--      and `amount_paid` the derived cache recomputed from the children —
--      never incremented, per Landing A's rule.
--
--   6. cash_request legacy UX (gap §6.7) — beneficiary, OPS/OVH category with
--      cost-centre/justification context, and remarks. The approved-costing
--      line import (costing_lines_get in the legacy) is a service route, not
--      schema; the columns here are what it writes into.
--
-- Money and quantity columns follow 0497's convention: non-negative CHECKs
-- added NOT VALID (they enforce from the moment they land without scanning
-- historical rows).
--
-- IDEMPOTENCY: this file is a NEW migration, so it must be safe to run twice
-- (the CI gate applies the tenant set twice on purpose). Tables and indexes
-- carry IF NOT EXISTS; every ADD CONSTRAINT is wrapped in a DO block guarded by
-- pg_constraint, because Postgres has no ADD CONSTRAINT IF NOT EXISTS.
-- ============================================================================

-- ── 1/2/3. Purchase order header + entity + per-line tax ──────────────────
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS entity_id        uuid REFERENCES corporate_entity(entity_id);
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS currency         char(3) NOT NULL DEFAULT 'XAF';
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS delivery_on      date;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS delivery_location text;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS payment_means    text
  CHECK (payment_means IN ('BANK','CASH','MOBILE_MONEY','CHEQUE'));
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS pay_days         integer NOT NULL DEFAULT 0;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS bank_block       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS air_rate         numeric(9,4) NOT NULL DEFAULT 0;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS adv_paid         numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS terms            text;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS remarks          text;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS due_on           date;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS total_ht         numeric(18,2);
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS total_vat        numeric(18,2);
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS net_payable      numeric(18,2);
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS amount_paid      numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS supplier_name    text;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS supplier_niu     text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_air_rate_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_air_rate_nonneg CHECK (air_rate >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_adv_paid_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_adv_paid_nonneg CHECK (adv_paid >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_amount_paid_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_amount_paid_nonneg CHECK (amount_paid >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_total_ht_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_total_ht_nonneg CHECK (total_ht IS NULL OR total_ht >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_total_vat_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_total_vat_nonneg CHECK (total_vat IS NULL OR total_vat >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_net_payable_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_net_payable_nonneg CHECK (net_payable IS NULL OR net_payable >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_pay_days_nonneg') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_pay_days_nonneg CHECK (pay_days >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE purchase_order_item ADD COLUMN IF NOT EXISTS tax_code_id uuid REFERENCES tax_code(tax_code_id);

-- ── 4. Procurement GRN: document identity + received lines ────────────────
ALTER TABLE goods_received_note ADD COLUMN IF NOT EXISTS doc_number  text;
ALTER TABLE goods_received_note ADD COLUMN IF NOT EXISTS entity_id   uuid REFERENCES corporate_entity(entity_id);
ALTER TABLE goods_received_note ADD COLUMN IF NOT EXISTS received_on date;
ALTER TABLE goods_received_note ADD COLUMN IF NOT EXISTS note        text;

CREATE TABLE IF NOT EXISTS goods_received_line (
  grn_line_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id             uuid NOT NULL REFERENCES goods_received_note(grn_id) ON DELETE CASCADE,
  dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id),
  label              text NOT NULL,
  ordered            numeric(18,4) NOT NULL DEFAULT 0,
  received           numeric(18,4) NOT NULL DEFAULT 0,
  condition          text
);
CREATE INDEX IF NOT EXISTS idx_grn_line_grn_id ON goods_received_line(grn_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_grn_line_ordered_nonneg') THEN
    ALTER TABLE goods_received_line ADD CONSTRAINT chk_grn_line_ordered_nonneg CHECK (ordered >= 0) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_grn_line_received_nonneg') THEN
    ALTER TABLE goods_received_line ADD CONSTRAINT chk_grn_line_received_nonneg CHECK (received >= 0) NOT VALID;
  END IF;
END $$;

-- ── 5. Supplier invoice AP payments ────────────────────────────────────────
ALTER TABLE supplier_invoice ADD COLUMN IF NOT EXISTS amount_paid numeric(18,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_invoice_amount_paid_nonneg') THEN
    ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_amount_paid_nonneg CHECK (amount_paid >= 0) NOT VALID;
  END IF;
END $$;
-- A payment can never outrun the invoice it settles (DATA 1.2 sum-invariant
-- style, same as chk_advance_applied_within_amount in 0497).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_invoice_paid_within_total') THEN
    ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_paid_within_total
      CHECK (amount_paid <= amount_ttc) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_invoice_payment (
  payment_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id   uuid NOT NULL REFERENCES supplier_invoice(supplier_invoice_id) ON DELETE CASCADE,
  treasury_account_id   uuid REFERENCES treasury_account(treasury_account_id),
  amount                numeric(18,2) NOT NULL,
  paid_on               date NOT NULL DEFAULT CURRENT_DATE,
  entry_id              uuid REFERENCES journal_entry(entry_id),
  note                  text,
  created_by            uuid REFERENCES app_user(user_id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_si_payment_invoice ON supplier_invoice_payment(supplier_invoice_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_invoice_payment_amount_nonneg') THEN
    ALTER TABLE supplier_invoice_payment ADD CONSTRAINT chk_supplier_invoice_payment_amount_nonneg CHECK (amount >= 0) NOT VALID;
  END IF;
END $$;

-- ── 6. Cash request legacy UX ──────────────────────────────────────────────
ALTER TABLE cash_request ADD COLUMN IF NOT EXISTS beneficiary            text;
ALTER TABLE cash_request ADD COLUMN IF NOT EXISTS category               text NOT NULL DEFAULT 'OPS'
  CHECK (category IN ('OPS','OVH'));
ALTER TABLE cash_request ADD COLUMN IF NOT EXISTS cost_center            text;
ALTER TABLE cash_request ADD COLUMN IF NOT EXISTS overhead_justification text;
ALTER TABLE cash_request ADD COLUMN IF NOT EXISTS remarks                text;

-- DOWN
-- DROP TABLE IF EXISTS supplier_invoice_payment;
-- DROP TABLE IF EXISTS goods_received_line;
-- ALTER TABLE purchase_order        DROP COLUMN IF EXISTS entity_id, DROP COLUMN IF EXISTS currency, ...;
-- ALTER TABLE purchase_order_item   DROP COLUMN IF EXISTS tax_code_id;
-- ALTER TABLE goods_received_note   DROP COLUMN IF EXISTS doc_number, DROP COLUMN IF EXISTS entity_id, DROP COLUMN IF EXISTS received_on, DROP COLUMN IF EXISTS note;
-- ALTER TABLE supplier_invoice      DROP COLUMN IF EXISTS amount_paid;
-- ALTER TABLE cash_request          DROP COLUMN IF EXISTS beneficiary, DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS cost_center, DROP COLUMN IF EXISTS overhead_justification, DROP COLUMN IF EXISTS remarks;
