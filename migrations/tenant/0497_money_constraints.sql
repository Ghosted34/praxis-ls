-- 0497 — Money and quantity columns can no longer go negative.
--
-- Audit DATA 1.1 (Critical). Of ~103 numeric money/quantity columns in the
-- tenant schema, exactly THREE carried a CHECK: journal_line.debit,
-- journal_line.credit and employee_earning.amount. Everything else accepted a
-- negative invoice total, a negative stock quantity, a negative payroll net.
--
-- Validation lives only in Zod, so any path that bypasses the validator — a
-- worker, an orchestration handler, an AI action, a support fix, a future
-- endpoint — could write one permanently and silently. The ledger triggers do
-- not catch it because these are not ledger tables.
--
-- Also DATA 1.2 (Critical): sum invariants. `advance` and `regie_advance`
-- carried a total and its consumed portion with nothing tying them together,
-- and `payment_allocation` had no uniqueness, so one receipt could be allocated
-- to the same invoice twice.
--
-- ============================ NOT VALID ============================
-- Every constraint is added NOT VALID, and that is the whole design.
--
--   NOT VALID enforces the rule on every INSERT and UPDATE from the moment it
--   lands, but does NOT scan the existing table. So:
--     · the migration cannot fail on historical bad data
--     · it takes a brief lock instead of a full table scan
--     · the bleeding stops immediately
--
--   What it does not do is prove the existing rows are clean. That is a data
--   question, not a schema one. Run scripts/db/probe-money-constraints.js to
--   find violations, fix them with the accountant, then VALIDATE:
--
--       ALTER TABLE invoice VALIDATE CONSTRAINT chk_invoice_total_ttc_nonneg;
--
--   VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock, so it does not block
--   reads or writes and can be run any time.
--
-- ============================ WHAT IS EXCLUDED ============================
-- Curated, not generated. Three columns are deliberately left unconstrained
-- because negative is CORRECT for them:
--
--   stock_movement.qty     a SIGNED delta — negative is an outbound movement.
--                          inventory.service.js applies it as `qty_on_hand +
--                          delta` and already rejects a result below zero.
--                          Constraining this would break every dispatch.
--   kpi_target.target_value  a target can be a reduction
--   appraisal.actual_value   likewise
--
-- inventory_item.qty_on_hand IS constrained — that is the balance, and the
-- audit's actual concern (DATA 5.1) is that it can be driven negative.


-- ---------------------------------------------------------------- non-negative
ALTER TABLE advance ADD CONSTRAINT chk_advance_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE advance ADD CONSTRAINT chk_advance_applied_amount_nonneg CHECK (applied_amount >= 0) NOT VALID;
ALTER TABLE asset ADD CONSTRAINT chk_asset_acquisition_cost_nonneg CHECK (acquisition_cost >= 0) NOT VALID;
ALTER TABLE asset ADD CONSTRAINT chk_asset_residual_value_nonneg CHECK (residual_value >= 0) NOT VALID;
ALTER TABLE cash_request ADD CONSTRAINT chk_cash_request_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE cash_request_line ADD CONSTRAINT chk_cash_request_line_budget_amount_nonneg CHECK (budget_amount >= 0) NOT VALID;
ALTER TABLE cash_request_line ADD CONSTRAINT chk_cash_request_line_spent_amount_nonneg CHECK (spent_amount >= 0) NOT VALID;
ALTER TABLE cash_request_payment ADD CONSTRAINT chk_cash_request_payment_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE cost_entry ADD CONSTRAINT chk_cost_entry_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE costing_line ADD CONSTRAINT chk_costing_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE costing_line ADD CONSTRAINT chk_costing_line_unit_cost_nonneg CHECK (unit_cost >= 0) NOT VALID;
ALTER TABLE debt_engagement ADD CONSTRAINT chk_debt_engagement_interest_rate_nonneg CHECK (interest_rate >= 0) NOT VALID;
ALTER TABLE delivery_note_line ADD CONSTRAINT chk_delivery_note_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE depreciation_schedule ADD CONSTRAINT chk_depreciation_schedule_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE dictionary_item ADD CONSTRAINT chk_dictionary_item_default_price_nonneg CHECK (default_price >= 0) NOT VALID;
ALTER TABLE employee ADD CONSTRAINT chk_employee_base_salary_nonneg CHECK (base_salary >= 0) NOT VALID;
ALTER TABLE employee ADD CONSTRAINT chk_employee_risk_class_rate_nonneg CHECK (risk_class_rate >= 0) NOT VALID;
ALTER TABLE expense_rate ADD CONSTRAINT chk_expense_rate_rate_nonneg CHECK (rate >= 0) NOT VALID;
ALTER TABLE extra_charge_simulation ADD CONSTRAINT chk_extra_charge_simulation_total_amount_nonneg CHECK (total_amount >= 0) NOT VALID;
ALTER TABLE fuel_log ADD CONSTRAINT chk_fuel_log_cost_nonneg CHECK (cost >= 0) NOT VALID;
ALTER TABLE invoice ADD CONSTRAINT chk_invoice_debours_total_nonneg CHECK (debours_total >= 0) NOT VALID;
ALTER TABLE invoice ADD CONSTRAINT chk_invoice_service_ht_nonneg CHECK (service_ht >= 0) NOT VALID;
ALTER TABLE invoice ADD CONSTRAINT chk_invoice_total_ttc_nonneg CHECK (total_ttc >= 0) NOT VALID;
ALTER TABLE invoice ADD CONSTRAINT chk_invoice_vat_total_nonneg CHECK (vat_total >= 0) NOT VALID;
ALTER TABLE invoice_line ADD CONSTRAINT chk_invoice_line_line_ht_nonneg CHECK (line_ht >= 0) NOT VALID;
ALTER TABLE invoice_line ADD CONSTRAINT chk_invoice_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE invoice_line ADD CONSTRAINT chk_invoice_line_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE kpi_target ADD CONSTRAINT chk_kpi_target_weight_nonneg CHECK (weight >= 0) NOT VALID;
ALTER TABLE leave_request ADD CONSTRAINT chk_leave_request_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE margin_simulation ADD CONSTRAINT chk_margin_simulation_total_cost_nonneg CHECK (total_cost >= 0) NOT VALID;
ALTER TABLE margin_simulation ADD CONSTRAINT chk_margin_simulation_total_price_nonneg CHECK (total_price >= 0) NOT VALID;
ALTER TABLE margin_simulation_line ADD CONSTRAINT chk_margin_simulation_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE margin_simulation_line ADD CONSTRAINT chk_margin_simulation_line_unit_cost_nonneg CHECK (unit_cost >= 0) NOT VALID;
ALTER TABLE margin_simulation_line ADD CONSTRAINT chk_margin_simulation_line_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE opportunity ADD CONSTRAINT chk_opportunity_estimated_value_nonneg CHECK (estimated_value >= 0) NOT VALID;
ALTER TABLE outbound_line ADD CONSTRAINT chk_outbound_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE payment_allocation ADD CONSTRAINT chk_payment_allocation_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE payment_receipt ADD CONSTRAINT chk_payment_receipt_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE payroll_run_item ADD CONSTRAINT chk_payroll_run_item_gross_nonneg CHECK (gross >= 0) NOT VALID;
ALTER TABLE payroll_run_item ADD CONSTRAINT chk_payroll_run_item_net_pay_nonneg CHECK (net_pay >= 0) NOT VALID;
ALTER TABLE pricing_variance ADD CONSTRAINT chk_pricing_variance_actual_cost_nonneg CHECK (actual_cost >= 0) NOT VALID;
ALTER TABLE pricing_variance ADD CONSTRAINT chk_pricing_variance_quoted_price_nonneg CHECK (quoted_price >= 0) NOT VALID;
ALTER TABLE proposal_line ADD CONSTRAINT chk_proposal_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE proposal_line ADD CONSTRAINT chk_proposal_line_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE purchase_order ADD CONSTRAINT chk_purchase_order_total_ttc_nonneg CHECK (total_ttc >= 0) NOT VALID;
ALTER TABLE purchase_order_item ADD CONSTRAINT chk_purchase_order_item_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE purchase_order_item ADD CONSTRAINT chk_purchase_order_item_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE purchase_request_line ADD CONSTRAINT chk_purchase_request_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE purchase_request_line ADD CONSTRAINT chk_purchase_request_line_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE quotation ADD CONSTRAINT chk_quotation_total_ht_nonneg CHECK (total_ht >= 0) NOT VALID;
ALTER TABLE quotation ADD CONSTRAINT chk_quotation_total_ttc_nonneg CHECK (total_ttc >= 0) NOT VALID;
ALTER TABLE quotation_line ADD CONSTRAINT chk_quotation_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE quotation_line ADD CONSTRAINT chk_quotation_line_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE regie_advance ADD CONSTRAINT chk_regie_advance_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE regie_advance ADD CONSTRAINT chk_regie_advance_justified_amount_nonneg CHECK (justified_amount >= 0) NOT VALID;
ALTER TABLE regie_advance ADD CONSTRAINT chk_regie_advance_returned_amount_nonneg CHECK (returned_amount >= 0) NOT VALID;
ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_amount_ht_nonneg CHECK (amount_ht >= 0) NOT VALID;
ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_amount_ttc_nonneg CHECK (amount_ttc >= 0) NOT VALID;
ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_vat_total_nonneg CHECK (vat_total >= 0) NOT VALID;
ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_wht_total_nonneg CHECK (wht_total >= 0) NOT VALID;
ALTER TABLE supplier_invoice_line ADD CONSTRAINT chk_supplier_invoice_line_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE supplier_invoice_line ADD CONSTRAINT chk_supplier_invoice_line_unit_price_nonneg CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE transit_order ADD CONSTRAINT chk_transit_order_declared_value_nonneg CHECK (declared_value >= 0) NOT VALID;
ALTER TABLE work_order ADD CONSTRAINT chk_work_order_cost_nonneg CHECK (cost >= 0) NOT VALID;
ALTER TABLE work_order_part ADD CONSTRAINT chk_work_order_part_qty_nonneg CHECK (qty >= 0) NOT VALID;
ALTER TABLE work_order_part ADD CONSTRAINT chk_work_order_part_unit_cost_nonneg CHECK (unit_cost >= 0) NOT VALID;

-- ---------------------------------------------------------- strictly positive
-- A zero or negative rate does not error: it silently produces a zero-value or
-- sign-flipped conversion, which is worse than a failure.
ALTER TABLE costing ADD CONSTRAINT chk_costing_exchange_rate_to_xaf_positive CHECK (exchange_rate_to_xaf > 0) NOT VALID;
ALTER TABLE fx_rate_daily ADD CONSTRAINT chk_fx_rate_daily_rate_positive CHECK (rate > 0) NOT VALID;
ALTER TABLE invoice ADD CONSTRAINT chk_invoice_fx_rate_positive CHECK (fx_rate > 0) NOT VALID;
ALTER TABLE journal_line ADD CONSTRAINT chk_journal_line_fx_rate_positive CHECK (fx_rate > 0) NOT VALID;
ALTER TABLE supplier_invoice ADD CONSTRAINT chk_supplier_invoice_fx_rate_positive CHECK (fx_rate > 0) NOT VALID;

-- asset.useful_life_months is the divisor in the depreciation schedule. Zero
-- is a division-by-zero at best; it is validated only in Zod (asset.validator.js:15).
ALTER TABLE asset ADD CONSTRAINT chk_asset_useful_life_positive CHECK (useful_life_months > 0) NOT VALID;

-- --------------------------------------------------- DATA 1.2: sum invariants
-- A total and its consumed portion with nothing tying them together. The
-- over-allocation case is reachable in practice (audit 5.3).
ALTER TABLE advance ADD CONSTRAINT chk_advance_applied_within_amount
  CHECK (applied_amount <= amount) NOT VALID;
ALTER TABLE regie_advance ADD CONSTRAINT chk_regie_advance_consumed_within_amount
  CHECK (justified_amount + returned_amount <= amount) NOT VALID;

-- DATA 7.1: the same receipt could be allocated to the same invoice twice.
-- A partial UNIQUE index rather than a constraint so it can be built without
-- rewriting the table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocation_receipt_invoice
  ON payment_allocation (receipt_id, invoice_id);

-- DATA 1.5: self-referencing hierarchies had no cycle guard, so a row could be
-- made its own parent and every recursive walk over the tree would spin.
ALTER TABLE chart_of_accounts ADD CONSTRAINT chk_coa_no_self_parent
  CHECK (parent_code IS NULL OR parent_code <> code) NOT VALID;

-- DOWN
-- Fully reversible: dropping a constraint loses no data. It only restores the
-- ability to write a negative invoice total.
--
-- ALTER TABLE advance DROP CONSTRAINT IF EXISTS chk_advance_amount_nonneg;
-- ALTER TABLE advance DROP CONSTRAINT IF EXISTS chk_advance_applied_amount_nonneg;
-- ALTER TABLE asset DROP CONSTRAINT IF EXISTS chk_asset_acquisition_cost_nonneg;
-- ALTER TABLE asset DROP CONSTRAINT IF EXISTS chk_asset_residual_value_nonneg;
-- ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS chk_cash_request_amount_nonneg;
-- ALTER TABLE cash_request_line DROP CONSTRAINT IF EXISTS chk_cash_request_line_budget_amount_nonneg;
-- ALTER TABLE cash_request_line DROP CONSTRAINT IF EXISTS chk_cash_request_line_spent_amount_nonneg;
-- ALTER TABLE cash_request_payment DROP CONSTRAINT IF EXISTS chk_cash_request_payment_amount_nonneg;
-- ALTER TABLE cost_entry DROP CONSTRAINT IF EXISTS chk_cost_entry_amount_nonneg;
-- ALTER TABLE costing_line DROP CONSTRAINT IF EXISTS chk_costing_line_qty_nonneg;
-- ALTER TABLE costing_line DROP CONSTRAINT IF EXISTS chk_costing_line_unit_cost_nonneg;
-- ALTER TABLE debt_engagement DROP CONSTRAINT IF EXISTS chk_debt_engagement_interest_rate_nonneg;
-- ALTER TABLE delivery_note_line DROP CONSTRAINT IF EXISTS chk_delivery_note_line_qty_nonneg;
-- ALTER TABLE depreciation_schedule DROP CONSTRAINT IF EXISTS chk_depreciation_schedule_amount_nonneg;
-- ALTER TABLE dictionary_item DROP CONSTRAINT IF EXISTS chk_dictionary_item_default_price_nonneg;
-- ALTER TABLE employee DROP CONSTRAINT IF EXISTS chk_employee_base_salary_nonneg;
-- ALTER TABLE employee DROP CONSTRAINT IF EXISTS chk_employee_risk_class_rate_nonneg;
-- ALTER TABLE expense_rate DROP CONSTRAINT IF EXISTS chk_expense_rate_rate_nonneg;
-- ALTER TABLE extra_charge_simulation DROP CONSTRAINT IF EXISTS chk_extra_charge_simulation_total_amount_nonneg;
-- ALTER TABLE fuel_log DROP CONSTRAINT IF EXISTS chk_fuel_log_cost_nonneg;
-- ALTER TABLE invoice DROP CONSTRAINT IF EXISTS chk_invoice_debours_total_nonneg;
-- ALTER TABLE invoice DROP CONSTRAINT IF EXISTS chk_invoice_service_ht_nonneg;
-- ALTER TABLE invoice DROP CONSTRAINT IF EXISTS chk_invoice_total_ttc_nonneg;
-- ALTER TABLE invoice DROP CONSTRAINT IF EXISTS chk_invoice_vat_total_nonneg;
-- ALTER TABLE invoice_line DROP CONSTRAINT IF EXISTS chk_invoice_line_line_ht_nonneg;
-- ALTER TABLE invoice_line DROP CONSTRAINT IF EXISTS chk_invoice_line_qty_nonneg;
-- ALTER TABLE invoice_line DROP CONSTRAINT IF EXISTS chk_invoice_line_unit_price_nonneg;
-- ALTER TABLE kpi_target DROP CONSTRAINT IF EXISTS chk_kpi_target_weight_nonneg;
-- ALTER TABLE leave_request DROP CONSTRAINT IF EXISTS chk_leave_request_amount_nonneg;
-- ALTER TABLE margin_simulation DROP CONSTRAINT IF EXISTS chk_margin_simulation_total_cost_nonneg;
-- ALTER TABLE margin_simulation DROP CONSTRAINT IF EXISTS chk_margin_simulation_total_price_nonneg;
-- ALTER TABLE margin_simulation_line DROP CONSTRAINT IF EXISTS chk_margin_simulation_line_qty_nonneg;
-- ALTER TABLE margin_simulation_line DROP CONSTRAINT IF EXISTS chk_margin_simulation_line_unit_cost_nonneg;
-- ALTER TABLE margin_simulation_line DROP CONSTRAINT IF EXISTS chk_margin_simulation_line_unit_price_nonneg;
-- ALTER TABLE opportunity DROP CONSTRAINT IF EXISTS chk_opportunity_estimated_value_nonneg;
-- ALTER TABLE outbound_line DROP CONSTRAINT IF EXISTS chk_outbound_line_qty_nonneg;
-- ALTER TABLE payment_allocation DROP CONSTRAINT IF EXISTS chk_payment_allocation_amount_nonneg;
-- ALTER TABLE payment_receipt DROP CONSTRAINT IF EXISTS chk_payment_receipt_amount_nonneg;
-- ALTER TABLE payroll_run_item DROP CONSTRAINT IF EXISTS chk_payroll_run_item_gross_nonneg;
-- ALTER TABLE payroll_run_item DROP CONSTRAINT IF EXISTS chk_payroll_run_item_net_pay_nonneg;
-- ALTER TABLE pricing_variance DROP CONSTRAINT IF EXISTS chk_pricing_variance_actual_cost_nonneg;
-- ALTER TABLE pricing_variance DROP CONSTRAINT IF EXISTS chk_pricing_variance_quoted_price_nonneg;
-- ALTER TABLE proposal_line DROP CONSTRAINT IF EXISTS chk_proposal_line_qty_nonneg;
-- ALTER TABLE proposal_line DROP CONSTRAINT IF EXISTS chk_proposal_line_unit_price_nonneg;
-- ALTER TABLE purchase_order DROP CONSTRAINT IF EXISTS chk_purchase_order_total_ttc_nonneg;
-- ALTER TABLE purchase_order_item DROP CONSTRAINT IF EXISTS chk_purchase_order_item_qty_nonneg;
-- ALTER TABLE purchase_order_item DROP CONSTRAINT IF EXISTS chk_purchase_order_item_unit_price_nonneg;
-- ALTER TABLE purchase_request_line DROP CONSTRAINT IF EXISTS chk_purchase_request_line_qty_nonneg;
-- ALTER TABLE purchase_request_line DROP CONSTRAINT IF EXISTS chk_purchase_request_line_unit_price_nonneg;
-- ALTER TABLE quotation DROP CONSTRAINT IF EXISTS chk_quotation_total_ht_nonneg;
-- ALTER TABLE quotation DROP CONSTRAINT IF EXISTS chk_quotation_total_ttc_nonneg;
-- ALTER TABLE quotation_line DROP CONSTRAINT IF EXISTS chk_quotation_line_qty_nonneg;
-- ALTER TABLE quotation_line DROP CONSTRAINT IF EXISTS chk_quotation_line_unit_price_nonneg;
-- ALTER TABLE regie_advance DROP CONSTRAINT IF EXISTS chk_regie_advance_amount_nonneg;
-- ALTER TABLE regie_advance DROP CONSTRAINT IF EXISTS chk_regie_advance_justified_amount_nonneg;
-- ALTER TABLE regie_advance DROP CONSTRAINT IF EXISTS chk_regie_advance_returned_amount_nonneg;
-- ALTER TABLE supplier_invoice DROP CONSTRAINT IF EXISTS chk_supplier_invoice_amount_ht_nonneg;
-- ALTER TABLE supplier_invoice DROP CONSTRAINT IF EXISTS chk_supplier_invoice_amount_ttc_nonneg;
-- ALTER TABLE supplier_invoice DROP CONSTRAINT IF EXISTS chk_supplier_invoice_vat_total_nonneg;
-- ALTER TABLE supplier_invoice DROP CONSTRAINT IF EXISTS chk_supplier_invoice_wht_total_nonneg;
-- ALTER TABLE supplier_invoice_line DROP CONSTRAINT IF EXISTS chk_supplier_invoice_line_qty_nonneg;
-- ALTER TABLE supplier_invoice_line DROP CONSTRAINT IF EXISTS chk_supplier_invoice_line_unit_price_nonneg;
-- ALTER TABLE transit_order DROP CONSTRAINT IF EXISTS chk_transit_order_declared_value_nonneg;
-- ALTER TABLE work_order DROP CONSTRAINT IF EXISTS chk_work_order_cost_nonneg;
-- ALTER TABLE work_order_part DROP CONSTRAINT IF EXISTS chk_work_order_part_qty_nonneg;
-- ALTER TABLE work_order_part DROP CONSTRAINT IF EXISTS chk_work_order_part_unit_cost_nonneg;
-- ALTER TABLE costing DROP CONSTRAINT IF EXISTS chk_costing_exchange_rate_to_xaf_positive;
-- ALTER TABLE fx_rate_daily DROP CONSTRAINT IF EXISTS chk_fx_rate_daily_rate_positive;
-- ALTER TABLE invoice DROP CONSTRAINT IF EXISTS chk_invoice_fx_rate_positive;
-- ALTER TABLE journal_line DROP CONSTRAINT IF EXISTS chk_journal_line_fx_rate_positive;
-- ALTER TABLE supplier_invoice DROP CONSTRAINT IF EXISTS chk_supplier_invoice_fx_rate_positive;
-- ALTER TABLE asset DROP CONSTRAINT IF EXISTS chk_asset_useful_life_positive;
-- ALTER TABLE advance DROP CONSTRAINT IF EXISTS chk_advance_applied_within_amount;
-- ALTER TABLE regie_advance DROP CONSTRAINT IF EXISTS chk_regie_advance_consumed_within_amount;
-- DROP INDEX IF EXISTS uq_payment_allocation_receipt_invoice;
-- ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS chk_coa_no_self_parent;
