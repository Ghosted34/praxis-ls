-- 0498 — Stop financial history being cascade-deleted, and make document
--        numbers unique.
--
-- Audit DATA 2.1 (Critical) and DATA 1.6 / 7.1 (High).
--
-- ============================ 2.1: CASCADE ============================
-- 74 foreign keys use ON DELETE CASCADE. On configuration and genuinely-owned
-- children that is right. On the nine below it destroys records that must be
-- preserved — including rows carrying `entry_id` references to real journal
-- entries, so deleting a parent silently erases financial history while the GL
-- entries remain and the two diverge with no trace.
--
-- The realistic path to loss is not a hand-written DELETE. The shared CRUD kit
-- runs a real DELETE when `deleteMode: "hard"` and the table has no active
-- column (resource.js:135-140). `asset` has no active column. Its
-- soft_delete.payload_json snapshots the PARENT ROW ONLY — the children are not
-- snapshotted, so they are simply gone.
--
-- RESTRICT, not CASCADE. The pattern already exists and is correct in the
-- ledger: journal_line → journal_entry cascades, and that is safe ONLY because
-- `protect_validated_entry` blocks deleting a validated entry. Block the parent
-- delete rather than silently destroy the child. A delete that fails loudly is
-- a five-second conversation; one that succeeds quietly is an audit finding
-- eighteen months later.
--
-- Callers that legitimately need to remove a parent must now delete the
-- children explicitly, which is the point: it makes the loss deliberate.

ALTER TABLE depreciation_schedule DROP CONSTRAINT IF EXISTS depreciation_schedule_asset_id_fkey;
ALTER TABLE depreciation_schedule ADD CONSTRAINT depreciation_schedule_asset_id_fkey
  FOREIGN KEY (asset_id) REFERENCES asset(asset_id) ON DELETE RESTRICT;

ALTER TABLE payment_allocation DROP CONSTRAINT IF EXISTS payment_allocation_receipt_id_fkey;
ALTER TABLE payment_allocation ADD CONSTRAINT payment_allocation_receipt_id_fkey
  FOREIGN KEY (receipt_id) REFERENCES payment_receipt(receipt_id) ON DELETE RESTRICT;

ALTER TABLE invoice_line DROP CONSTRAINT IF EXISTS invoice_line_invoice_id_fkey;
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoice(invoice_id) ON DELETE RESTRICT;

ALTER TABLE supplier_invoice_line DROP CONSTRAINT IF EXISTS supplier_invoice_line_supplier_invoice_id_fkey;
ALTER TABLE supplier_invoice_line ADD CONSTRAINT supplier_invoice_line_supplier_invoice_id_fkey
  FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoice(supplier_invoice_id) ON DELETE RESTRICT;

ALTER TABLE cash_request_payment DROP CONSTRAINT IF EXISTS cash_request_payment_cash_request_id_fkey;
ALTER TABLE cash_request_payment ADD CONSTRAINT cash_request_payment_cash_request_id_fkey
  FOREIGN KEY (cash_request_id) REFERENCES cash_request(cash_request_id) ON DELETE RESTRICT;

ALTER TABLE debt_repayment DROP CONSTRAINT IF EXISTS debt_repayment_debt_engagement_id_fkey;
ALTER TABLE debt_repayment ADD CONSTRAINT debt_repayment_debt_engagement_id_fkey
  FOREIGN KEY (debt_engagement_id) REFERENCES debt_engagement(debt_engagement_id) ON DELETE RESTRICT;

-- The comment at inventory.repo.js:6 calls this "its append-only movement
-- journal". It has no append-only trigger and was cascade-deleted with the item.
ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS stock_movement_inventory_item_id_fkey;
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_inventory_item_id_fkey
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_item(inventory_item_id) ON DELETE RESTRICT;

ALTER TABLE close_checklist DROP CONSTRAINT IF EXISTS close_checklist_period_id_fkey;
ALTER TABLE close_checklist ADD CONSTRAINT close_checklist_period_id_fkey
  FOREIGN KEY (period_id) REFERENCES accounting_period(period_id) ON DELETE RESTRICT;

ALTER TABLE payroll_run_item DROP CONSTRAINT IF EXISTS payroll_run_item_payroll_run_id_fkey;
ALTER TABLE payroll_run_item ADD CONSTRAINT payroll_run_item_payroll_run_id_fkey
  FOREIGN KEY (payroll_run_id) REFERENCES payroll_run(payroll_run_id) ON DELETE RESTRICT;

-- ==================== 1.6 / 7.1: document number uniqueness ====================
-- No table had a unique constraint or index on doc_number — verified across all
-- 62 tenant migrations. The allocator itself is sound (doc_sequence upsert with
-- RETURNING serialises correctly), but nothing stopped a duplicate arriving by
-- another route: a retried post, a manual correction, a data import. For a
-- statutory document series this is the one uniqueness guarantee that has to
-- live in the database.
--
-- PARTIAL indexes (WHERE doc_number IS NOT NULL) because the column is nullable
-- and a draft legitimately has none — several drafts must not collide on NULL.
--
-- CREATE UNIQUE INDEX fails if duplicates already exist. That is deliberate:
-- unlike a CHECK, there is no NOT VALID for uniqueness, and silently tolerating
-- duplicate statutory numbers is not an option. Run
-- scripts/db/probe-doc-numbers.js FIRST — it lists any collisions so they can be
-- resolved before this migration is applied.

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_doc_number
  ON invoice (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_note_doc_number
  ON delivery_note (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_costing_doc_number
  ON costing (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_request_doc_number
  ON purchase_request (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_doc_number
  ON purchase_order (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_invoice_doc_number
  ON supplier_invoice (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_request_doc_number
  ON cash_request (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_doc_number
  ON quotation (doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_doc_number
  ON proposal (doc_number) WHERE doc_number IS NOT NULL;

-- DOWN
-- Reversible. Restoring CASCADE re-opens DATA 2.1 (financial history can be
-- destroyed by deleting a parent) and dropping the unique indexes re-opens
-- DATA 1.6. Neither loses data.
--
-- ALTER TABLE depreciation_schedule DROP CONSTRAINT depreciation_schedule_asset_id_fkey;
-- ALTER TABLE depreciation_schedule ADD CONSTRAINT depreciation_schedule_asset_id_fkey
--   FOREIGN KEY (asset_id) REFERENCES asset(asset_id) ON DELETE CASCADE;
-- ALTER TABLE payment_allocation DROP CONSTRAINT payment_allocation_receipt_id_fkey;
-- ALTER TABLE payment_allocation ADD CONSTRAINT payment_allocation_receipt_id_fkey
--   FOREIGN KEY (receipt_id) REFERENCES payment_receipt(receipt_id) ON DELETE CASCADE;
-- ALTER TABLE invoice_line DROP CONSTRAINT invoice_line_invoice_id_fkey;
-- ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_invoice_id_fkey
--   FOREIGN KEY (invoice_id) REFERENCES invoice(invoice_id) ON DELETE CASCADE;
-- ALTER TABLE supplier_invoice_line DROP CONSTRAINT supplier_invoice_line_supplier_invoice_id_fkey;
-- ALTER TABLE supplier_invoice_line ADD CONSTRAINT supplier_invoice_line_supplier_invoice_id_fkey
--   FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoice(supplier_invoice_id) ON DELETE CASCADE;
-- ALTER TABLE cash_request_payment DROP CONSTRAINT cash_request_payment_cash_request_id_fkey;
-- ALTER TABLE cash_request_payment ADD CONSTRAINT cash_request_payment_cash_request_id_fkey
--   FOREIGN KEY (cash_request_id) REFERENCES cash_request(cash_request_id) ON DELETE CASCADE;
-- ALTER TABLE debt_repayment DROP CONSTRAINT debt_repayment_debt_engagement_id_fkey;
-- ALTER TABLE debt_repayment ADD CONSTRAINT debt_repayment_debt_engagement_id_fkey
--   FOREIGN KEY (debt_engagement_id) REFERENCES debt_engagement(debt_engagement_id) ON DELETE CASCADE;
-- ALTER TABLE stock_movement DROP CONSTRAINT stock_movement_inventory_item_id_fkey;
-- ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_inventory_item_id_fkey
--   FOREIGN KEY (inventory_item_id) REFERENCES inventory_item(inventory_item_id) ON DELETE CASCADE;
-- ALTER TABLE close_checklist DROP CONSTRAINT close_checklist_period_id_fkey;
-- ALTER TABLE close_checklist ADD CONSTRAINT close_checklist_period_id_fkey
--   FOREIGN KEY (period_id) REFERENCES accounting_period(period_id) ON DELETE CASCADE;
-- ALTER TABLE payroll_run_item DROP CONSTRAINT payroll_run_item_payroll_run_id_fkey;
-- ALTER TABLE payroll_run_item ADD CONSTRAINT payroll_run_item_payroll_run_id_fkey
--   FOREIGN KEY (payroll_run_id) REFERENCES payroll_run(payroll_run_id) ON DELETE CASCADE;
--
-- DROP INDEX IF EXISTS uq_invoice_doc_number;
-- DROP INDEX IF EXISTS uq_delivery_note_doc_number;
-- DROP INDEX IF EXISTS uq_costing_doc_number;
-- DROP INDEX IF EXISTS uq_purchase_request_doc_number;
-- DROP INDEX IF EXISTS uq_purchase_order_doc_number;
-- DROP INDEX IF EXISTS uq_supplier_invoice_doc_number;
-- DROP INDEX IF EXISTS uq_cash_request_doc_number;
-- DROP INDEX IF EXISTS uq_quotation_doc_number;
-- DROP INDEX IF EXISTS uq_proposal_doc_number;
