-- ============================================================================
-- TENANT DB — 10721 close the procurement port gaps
-- (doc/PROCUREMENT_PORT_LEGACY_ANALYSIS.md §0 + the four product decisions of
-- 2026-08-18: restore two-step cash approval, SI reversal incl. paid, PO-level
-- payment, full WMS GRN bridge).
--
-- EVERYTHING HERE IS ADDITIVE or a CHECK widening. The two status CHECKs are
-- widened exactly the way 10718 widened costing's (drop the auto-named
-- constraint, re-add a strict superset — never destructive to existing rows).
-- Tables/indexes are IF NOT EXISTS; every ADD CONSTRAINT is inside a DO block
-- guarded by pg_constraint; the workflow seed uses ON CONFLICT DO NOTHING, so
-- the file passes the idempotency gate and can be re-run.
--
-- WHAT THIS ADDS
--
--   1. purchase_order: UNLOCK_REQUESTED / PARTIAL / PAID statuses, the unlock
--      audit columns (same shape as costing 10718), supplier address/city
--      snapshot columns, paid_on/paid_by, and purchase_order_payment (the
--      legacy po_mark_paid story, no GL post — PO money is tracked here, GL
--      impact goes through the supplier invoice).
--   2. cash_request: VALIDATED restored (the legacy Finance-validate →
--      Management-approve two-step), validated_by/validated_at, and a
--      `disbursal.validated` approval event with a default MANAGEMENT chain.
--   3. supplier_invoice: reversed_at / reversed_by / reversal_reason — the
--      REVERSED state, listed since 0342, finally has a writer.
--   4. supplier_master.cached_overdue — the payables cache's overdue half,
--      which the legacy maintained and the rebuild never wrote.
--   5. WMS bridge: grn_inbound.po_id + goods_received_note.wms_inbound_id so
--      the procurement GRN can hand received lines to the warehouse.
-- ============================================================================

-- ── 1a. PO status vocabulary + unlock + payment + snapshot columns ─────────
ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS purchase_order_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_status_check') THEN
    ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_status_check CHECK (status IN (
      'DRAFT', 'ISSUED_LOCKED', 'APPROVED_LOCKED', 'RECEIVED', 'CLOSED',
      'CANCELLED', 'UNLOCK_REQUESTED', 'PARTIAL', 'PAID'
    ));
  END IF;
END $$;

ALTER TABLE purchase_order
  ADD COLUMN IF NOT EXISTS unlock_requested_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS unlock_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_reason       text,
  ADD COLUMN IF NOT EXISTS unlocked_by         uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS unlocked_at         timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_address    text,
  ADD COLUMN IF NOT EXISTS supplier_city       text,
  ADD COLUMN IF NOT EXISTS paid_on             date,
  ADD COLUMN IF NOT EXISTS paid_by             uuid REFERENCES app_user(user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_unlock_requested_attributed') THEN
    ALTER TABLE purchase_order
      ADD CONSTRAINT chk_purchase_order_unlock_requested_attributed
      CHECK (status <> 'UNLOCK_REQUESTED' OR unlock_requested_at IS NOT NULL) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_purchase_order_unlock_requested
  ON purchase_order (unlock_requested_at) WHERE status = 'UNLOCK_REQUESTED';

CREATE TABLE IF NOT EXISTS purchase_order_payment (
  payment_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id               uuid NOT NULL REFERENCES purchase_order(po_id) ON DELETE CASCADE,
  amount              numeric(18,2) NOT NULL,
  paid_on             date NOT NULL DEFAULT CURRENT_DATE,
  treasury_account_id uuid REFERENCES treasury_account(treasury_account_id),
  note                text,
  created_by          uuid REFERENCES app_user(user_id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_payment_po ON purchase_order_payment(po_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_order_payment_amount_nonneg') THEN
    ALTER TABLE purchase_order_payment ADD CONSTRAINT chk_purchase_order_payment_amount_nonneg CHECK (amount >= 0) NOT VALID;
  END IF;
END $$;

-- ── 2. Cash request: VALIDATED + the disbursal.validated approval event ────
ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS cash_request_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_request_status_check') THEN
    ALTER TABLE cash_request ADD CONSTRAINT cash_request_status_check CHECK (status IN (
      'DRAFT', 'SUBMITTED', 'VALIDATED', 'APPROVED', 'DISBURSED',
      'PARTIALLY_DISBURSED', 'JUSTIFIED', 'REJECTED'
    ));
  END IF;
END $$;
ALTER TABLE cash_request
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

-- The second approval leg: submitting opens disbursal.requested (finance
-- validates, per the 0492 default); VALIDATED opens disbursal.validated
-- (management approves). Idempotent: ON CONFLICT on the event key, and the
-- default workflow is only created when the event has none.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('disbursal.validated', 'MOD-49', 'Cash request validated', false, true)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  v_event uuid;
  v_role  uuid;
  v_wf    uuid;
BEGIN
  SELECT event_type_id INTO v_event FROM event_type WHERE key = 'disbursal.validated';
  IF v_event IS NULL THEN
    RAISE WARNING '[10721] disbursal.validated missing — default workflow not seeded';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM workflow WHERE event_type_id = v_event) THEN
    RETURN; -- never overwrite a tenant's own chain
  END IF;
  -- Management approves after finance validates (legacy: APPROVE = MD/Admin).
  SELECT role_id INTO v_role FROM role
   ORDER BY (CASE WHEN code = 'MANAGEMENT' THEN 0
                  WHEN code = 'ADMIN'      THEN 1
                  WHEN code = 'CEO'        THEN 2
                  WHEN code = 'FINANCE'    THEN 3
                  ELSE 4 END), is_system DESC
   LIMIT 1;
  IF v_role IS NULL THEN
    RAISE WARNING '[10721] no roles — disbursal.validated default workflow not seeded';
    RETURN;
  END IF;
  INSERT INTO workflow (event_type_id, name, is_active)
  VALUES (v_event, 'Cash request — approval (default)', true)
  RETURNING workflow_id INTO v_wf;
  INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
  VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');
  RAISE NOTICE '[10721] seeded the disbursal.validated default approval chain';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[10721] could not seed disbursal.validated workflow: %', SQLERRM;
END $$;

-- ── 3. Supplier invoice reversal columns ───────────────────────────────────
ALTER TABLE supplier_invoice
  ADD COLUMN IF NOT EXISTS reversed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by     uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;

-- ── 4. Supplier payables cache: the overdue half ───────────────────────────
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS cached_overdue numeric(18,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_cached_overdue_nonneg') THEN
    ALTER TABLE supplier_master ADD CONSTRAINT chk_supplier_cached_overdue_nonneg CHECK (cached_overdue >= 0) NOT VALID;
  END IF;
END $$;

-- ── 5. WMS bridge ──────────────────────────────────────────────────────────
-- source_grn_id is the procurement GRN that handed the goods over; the
-- procurement side links back via goods_received_note.wms_inbound_id, so each
-- side finds the other. (Missing from the first pass of this file — the
-- send-to-warehouse path would have failed at runtime with
-- `column source_grn_id does not exist`.)
ALTER TABLE grn_inbound ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_order(po_id);
ALTER TABLE grn_inbound ADD COLUMN IF NOT EXISTS source_grn_id uuid REFERENCES goods_received_note(grn_id);
ALTER TABLE goods_received_note ADD COLUMN IF NOT EXISTS wms_inbound_id uuid REFERENCES grn_inbound(grn_inbound_id);
CREATE INDEX IF NOT EXISTS ix_grn_inbound_source ON grn_inbound(source_grn_id) WHERE source_grn_id IS NOT NULL;

-- DOWN
-- The CHECK widenings are reversible only while no row sits in the new statuses.
--   ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS purchase_order_status_check;
--   ALTER TABLE cash_request    DROP CONSTRAINT IF EXISTS cash_request_status_check;
--   DROP TABLE IF EXISTS purchase_order_payment;
--   ALTER TABLE purchase_order    DROP COLUMN IF EXISTS unlock_requested_by, ... (audit trail);
--   ALTER TABLE cash_request      DROP COLUMN IF EXISTS validated_by, DROP COLUMN IF EXISTS validated_at;
--   ALTER TABLE supplier_invoice  DROP COLUMN IF EXISTS reversed_at, reversed_by, reversal_reason;
--   ALTER TABLE supplier_master   DROP COLUMN IF EXISTS cached_overdue;
--   ALTER TABLE grn_inbound       DROP COLUMN IF EXISTS po_id;
--   ALTER TABLE goods_received_note DROP COLUMN IF EXISTS wms_inbound_id;
