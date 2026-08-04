-- 0496 — Index every `created_at` the generic list path sorts on.
--
-- Audit PERF S3 (Critical, MEASURED). The highest value-per-effort item in all
-- seven audits: a single additive migration, no application code touched, no
-- behaviour change.
--
-- THE PROBLEM
--   `src/shared/crud/resource.js:23` defaults every list query to
--   `ORDER BY created_at DESC`, and the 24 hand-rolled repos repeat the same
--   clause. Not one table had an index on that column — verified by parsing the
--   DDL across all 62 tenant migrations: 127 tables declare `created_at`, zero
--   index it.
--
--   So every list screen in the product ran a full sequential scan plus a sort.
--   The audit measured it against a 200k-row table:
--
--       as shipped   26.34 ms,  3,710 buffers
--       with index    0.057 ms,      4 buffers      (462x)
--
--   It degrades linearly with row count, so it gets worse every month, and it
--   is paid on the first screen every user opens.
--
-- WHY PLAIN `CREATE INDEX`, NOT `CONCURRENTLY`
--   The migrator sends each file as one multi-statement simple query
--   (`services/platform/migrator.js:98`). Postgres wraps that in an implicit
--   transaction block, and CREATE INDEX CONCURRENTLY cannot run inside one — it
--   would fail the whole migration. Plain CREATE INDEX takes a SHARE lock that
--   blocks writes to each table while it builds.
--
--   That is acceptable here because `scripts/deploy.sh` runs migrations BEFORE
--   rolling the containers, on tables that are small today. Build time is
--   proportional to current row count, so this is cheapest applied now. If a
--   tenant has grown large enough for the lock to matter, run this file's
--   statements by hand with CONCURRENTLY outside the migrator instead.
--
-- WHY ALL 127 AND NOT A CHOSEN FEW
--   The default ORDER BY applies to every resource, so any table can be listed.
--   Picking "the big ones" means guessing which tables grow, and being wrong is
--   invisible until a screen is slow in production. The cost of an index on a
--   small table is a few pages and one more btree to maintain per insert; the
--   cost of a missing one is a sequential scan on a user-facing screen.
--
-- DESC to match the query exactly. A btree can be scanned backwards, so an ASC
-- index would also serve — DESC simply avoids the reverse scan.
--
-- IF NOT EXISTS throughout: safe to re-run, and safe on a tenant provisioned
-- after this file was written.


CREATE INDEX IF NOT EXISTS idx_access_review_created_at ON access_review (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_period_created_at ON accounting_period (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advance_created_at ON advance (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_action_catalogue_created_at ON ai_action_catalogue (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_action_run_created_at ON ai_action_run (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_budget_period_created_at ON ai_budget_period (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chunk_created_at ON ai_chunk (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversation_created_at ON ai_conversation (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_document_created_at ON ai_document (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feature_flag_created_at ON ai_feature_flag (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_message_created_at ON ai_message (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_vendor_credential_created_at ON ai_vendor_credential (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_user_created_at ON app_user (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appraisal_created_at ON appraisal (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_task_created_at ON approval_task (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_token_created_at ON approval_token (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_created_at ON asset (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_log_created_at ON attendance_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_sender_created_at ON campaign_sender (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_template_created_at ON campaign_template (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_request_created_at ON cash_request (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_created_at ON chart_of_accounts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_master_created_at ON client_master (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_attachment_created_at ON comms_attachment (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_group_created_at ON comms_group (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_message_created_at ON comms_message (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_quick_reply_created_at ON comms_quick_reply (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_reaction_created_at ON comms_reaction (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_star_created_at ON comms_star (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_flag_created_at ON compliance_flag (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_enquiry_created_at ON contact_enquiry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corporate_entity_created_at ON corporate_entity (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_entry_created_at ON cost_entry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_costing_created_at ON costing (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cycle_count_created_at ON cycle_count (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debt_engagement_created_at ON debt_engagement (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_note_created_at ON delivery_note (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dictionary_item_created_at ON dictionary_item (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_signature_created_at ON document_signature (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_vault_created_at ON document_vault (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossier_created_at ON dossier (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_license_created_at ON driver_license (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_attachment_created_at ON email_attachment (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_connection_created_at ON email_connection (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_identity_created_at ON email_identity (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_created_at ON employee (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_earning_created_at ON employee_earning (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_dispatch_created_at ON event_dispatch (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_type_created_at ON event_type (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_card_created_at ON execution_card (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_rate_created_at ON expense_rate (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extra_charge_simulation_created_at ON extra_charge_simulation (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_claim_created_at ON fleet_claim (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_dispatch_created_at ON fleet_dispatch (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_incident_created_at ON fleet_incident (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_log_created_at ON fuel_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_place_created_at ON geo_place (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goods_received_note_created_at ON goods_received_note (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grn_inbound_created_at ON grn_inbound (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_article_created_at ON help_article (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_contract_created_at ON hr_contract (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_query_created_at ON hr_query (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_sanction_created_at ON hr_sanction (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_immutable_ledger_created_at ON immutable_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_item_created_at ON inventory_item (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_created_at ON invoice (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_applicant_created_at ON job_applicant (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entry_created_at ON journal_entry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_target_created_at ON kpi_target (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_created_at ON lead (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_request_created_at ON leave_request (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_margin_simulation_created_at ON margin_simulation (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_campaign_created_at ON marketing_campaign (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_created_at ON meeting (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_note_created_at ON meeting_note (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestone_instance_created_at ON milestone_instance (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestone_template_created_at ON milestone_template (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_created_at ON notification (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_preference_created_at ON notification_preference (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_created_at ON onboarding_checklist (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_created_at ON opportunity (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_order_created_at ON outbound_order (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partnership_request_created_at ON partnership_request (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_created_at ON password_reset (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_gateway_created_at ON payment_gateway (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_receipt_created_at ON payment_receipt (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_run_created_at ON payroll_run (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_access_created_at ON portal_access (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_invite_created_at ON portal_invite (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_user_created_at ON portal_user (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posting_rule_created_at ON posting_rule (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposal_created_at ON proposal (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_order_created_at ON purchase_order (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_request_created_at ON purchase_request (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subscription_created_at ON push_subscription (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_q_ticket_created_at ON q_ticket (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_created_at ON quotation (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_regie_advance_created_at ON regie_advance (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_created_at ON reminder (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_created_at ON role (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_report_created_at ON saved_report (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_report_created_at ON scheduled_report (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scope_created_at ON scope (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_type_created_at ON service_type (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_document_created_at ON sop_document (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_success_story_created_at ON success_story (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_succession_plan_created_at ON succession_plan (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_created_at ON supplier_invoice (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_master_created_at ON supplier_master (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talent_pool_created_at ON talent_pool (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_calendar_created_at ON tax_calendar (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_code_created_at ON tax_code (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_declaration_created_at ON tax_declaration (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_jurisdiction_created_at ON tax_jurisdiction (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_created_at ON training (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transit_order_created_at ON transit_order (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treasury_account_created_at ON treasury_account (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_device_created_at ON user_device (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_session_created_at ON user_session (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vacancy_created_at ON vacancy (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_created_at ON vehicle (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_compliance_created_at ON vehicle_compliance (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wms_equipment_created_at ON wms_equipment (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_order_created_at ON work_order (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_site_created_at ON work_site (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_created_at ON workflow (created_at DESC);

-- DOWN
-- Fully reversible: dropping an index loses no data, it only restores the
-- sequential scans. Reverting is safe at any time.
--
-- DROP INDEX IF EXISTS idx_access_review_created_at;
-- DROP INDEX IF EXISTS idx_accounting_period_created_at;
-- DROP INDEX IF EXISTS idx_advance_created_at;
-- DROP INDEX IF EXISTS idx_ai_action_catalogue_created_at;
-- DROP INDEX IF EXISTS idx_ai_action_run_created_at;
-- DROP INDEX IF EXISTS idx_ai_budget_period_created_at;
-- DROP INDEX IF EXISTS idx_ai_chunk_created_at;
-- DROP INDEX IF EXISTS idx_ai_conversation_created_at;
-- DROP INDEX IF EXISTS idx_ai_document_created_at;
-- DROP INDEX IF EXISTS idx_ai_feature_flag_created_at;
-- DROP INDEX IF EXISTS idx_ai_message_created_at;
-- DROP INDEX IF EXISTS idx_ai_vendor_credential_created_at;
-- DROP INDEX IF EXISTS idx_app_user_created_at;
-- DROP INDEX IF EXISTS idx_appraisal_created_at;
-- DROP INDEX IF EXISTS idx_approval_task_created_at;
-- DROP INDEX IF EXISTS idx_approval_token_created_at;
-- DROP INDEX IF EXISTS idx_asset_created_at;
-- DROP INDEX IF EXISTS idx_attendance_log_created_at;
-- DROP INDEX IF EXISTS idx_campaign_sender_created_at;
-- DROP INDEX IF EXISTS idx_campaign_template_created_at;
-- DROP INDEX IF EXISTS idx_cash_request_created_at;
-- DROP INDEX IF EXISTS idx_chart_of_accounts_created_at;
-- DROP INDEX IF EXISTS idx_client_master_created_at;
-- DROP INDEX IF EXISTS idx_comms_attachment_created_at;
-- DROP INDEX IF EXISTS idx_comms_group_created_at;
-- DROP INDEX IF EXISTS idx_comms_message_created_at;
-- DROP INDEX IF EXISTS idx_comms_quick_reply_created_at;
-- DROP INDEX IF EXISTS idx_comms_reaction_created_at;
-- DROP INDEX IF EXISTS idx_comms_star_created_at;
-- DROP INDEX IF EXISTS idx_compliance_flag_created_at;
-- DROP INDEX IF EXISTS idx_contact_enquiry_created_at;
-- DROP INDEX IF EXISTS idx_corporate_entity_created_at;
-- DROP INDEX IF EXISTS idx_cost_entry_created_at;
-- DROP INDEX IF EXISTS idx_costing_created_at;
-- DROP INDEX IF EXISTS idx_cycle_count_created_at;
-- DROP INDEX IF EXISTS idx_debt_engagement_created_at;
-- DROP INDEX IF EXISTS idx_delivery_note_created_at;
-- DROP INDEX IF EXISTS idx_dictionary_item_created_at;
-- DROP INDEX IF EXISTS idx_document_signature_created_at;
-- DROP INDEX IF EXISTS idx_document_vault_created_at;
-- DROP INDEX IF EXISTS idx_dossier_created_at;
-- DROP INDEX IF EXISTS idx_driver_license_created_at;
-- DROP INDEX IF EXISTS idx_email_attachment_created_at;
-- DROP INDEX IF EXISTS idx_email_connection_created_at;
-- DROP INDEX IF EXISTS idx_email_identity_created_at;
-- DROP INDEX IF EXISTS idx_employee_created_at;
-- DROP INDEX IF EXISTS idx_employee_earning_created_at;
-- DROP INDEX IF EXISTS idx_event_dispatch_created_at;
-- DROP INDEX IF EXISTS idx_event_log_created_at;
-- DROP INDEX IF EXISTS idx_event_type_created_at;
-- DROP INDEX IF EXISTS idx_execution_card_created_at;
-- DROP INDEX IF EXISTS idx_expense_rate_created_at;
-- DROP INDEX IF EXISTS idx_extra_charge_simulation_created_at;
-- DROP INDEX IF EXISTS idx_fleet_claim_created_at;
-- DROP INDEX IF EXISTS idx_fleet_dispatch_created_at;
-- DROP INDEX IF EXISTS idx_fleet_incident_created_at;
-- DROP INDEX IF EXISTS idx_fuel_log_created_at;
-- DROP INDEX IF EXISTS idx_geo_place_created_at;
-- DROP INDEX IF EXISTS idx_goods_received_note_created_at;
-- DROP INDEX IF EXISTS idx_grn_inbound_created_at;
-- DROP INDEX IF EXISTS idx_help_article_created_at;
-- DROP INDEX IF EXISTS idx_hr_contract_created_at;
-- DROP INDEX IF EXISTS idx_hr_query_created_at;
-- DROP INDEX IF EXISTS idx_hr_sanction_created_at;
-- DROP INDEX IF EXISTS idx_immutable_ledger_created_at;
-- DROP INDEX IF EXISTS idx_inventory_item_created_at;
-- DROP INDEX IF EXISTS idx_invoice_created_at;
-- DROP INDEX IF EXISTS idx_job_applicant_created_at;
-- DROP INDEX IF EXISTS idx_journal_entry_created_at;
-- DROP INDEX IF EXISTS idx_kpi_target_created_at;
-- DROP INDEX IF EXISTS idx_lead_created_at;
-- DROP INDEX IF EXISTS idx_leave_request_created_at;
-- DROP INDEX IF EXISTS idx_margin_simulation_created_at;
-- DROP INDEX IF EXISTS idx_marketing_campaign_created_at;
-- DROP INDEX IF EXISTS idx_meeting_created_at;
-- DROP INDEX IF EXISTS idx_meeting_note_created_at;
-- DROP INDEX IF EXISTS idx_milestone_instance_created_at;
-- DROP INDEX IF EXISTS idx_milestone_template_created_at;
-- DROP INDEX IF EXISTS idx_notification_created_at;
-- DROP INDEX IF EXISTS idx_notification_preference_created_at;
-- DROP INDEX IF EXISTS idx_onboarding_checklist_created_at;
-- DROP INDEX IF EXISTS idx_opportunity_created_at;
-- DROP INDEX IF EXISTS idx_outbound_order_created_at;
-- DROP INDEX IF EXISTS idx_partnership_request_created_at;
-- DROP INDEX IF EXISTS idx_password_reset_created_at;
-- DROP INDEX IF EXISTS idx_payment_gateway_created_at;
-- DROP INDEX IF EXISTS idx_payment_receipt_created_at;
-- DROP INDEX IF EXISTS idx_payroll_run_created_at;
-- DROP INDEX IF EXISTS idx_portal_access_created_at;
-- DROP INDEX IF EXISTS idx_portal_invite_created_at;
-- DROP INDEX IF EXISTS idx_portal_user_created_at;
-- DROP INDEX IF EXISTS idx_posting_rule_created_at;
-- DROP INDEX IF EXISTS idx_proposal_created_at;
-- DROP INDEX IF EXISTS idx_purchase_order_created_at;
-- DROP INDEX IF EXISTS idx_purchase_request_created_at;
-- DROP INDEX IF EXISTS idx_push_subscription_created_at;
-- DROP INDEX IF EXISTS idx_q_ticket_created_at;
-- DROP INDEX IF EXISTS idx_quotation_created_at;
-- DROP INDEX IF EXISTS idx_regie_advance_created_at;
-- DROP INDEX IF EXISTS idx_reminder_created_at;
-- DROP INDEX IF EXISTS idx_role_created_at;
-- DROP INDEX IF EXISTS idx_saved_report_created_at;
-- DROP INDEX IF EXISTS idx_scheduled_report_created_at;
-- DROP INDEX IF EXISTS idx_scope_created_at;
-- DROP INDEX IF EXISTS idx_service_type_created_at;
-- DROP INDEX IF EXISTS idx_sop_document_created_at;
-- DROP INDEX IF EXISTS idx_success_story_created_at;
-- DROP INDEX IF EXISTS idx_succession_plan_created_at;
-- DROP INDEX IF EXISTS idx_supplier_invoice_created_at;
-- DROP INDEX IF EXISTS idx_supplier_master_created_at;
-- DROP INDEX IF EXISTS idx_talent_pool_created_at;
-- DROP INDEX IF EXISTS idx_tax_calendar_created_at;
-- DROP INDEX IF EXISTS idx_tax_code_created_at;
-- DROP INDEX IF EXISTS idx_tax_declaration_created_at;
-- DROP INDEX IF EXISTS idx_tax_jurisdiction_created_at;
-- DROP INDEX IF EXISTS idx_training_created_at;
-- DROP INDEX IF EXISTS idx_transit_order_created_at;
-- DROP INDEX IF EXISTS idx_treasury_account_created_at;
-- DROP INDEX IF EXISTS idx_user_device_created_at;
-- DROP INDEX IF EXISTS idx_user_session_created_at;
-- DROP INDEX IF EXISTS idx_vacancy_created_at;
-- DROP INDEX IF EXISTS idx_vehicle_created_at;
-- DROP INDEX IF EXISTS idx_vehicle_compliance_created_at;
-- DROP INDEX IF EXISTS idx_wms_equipment_created_at;
-- DROP INDEX IF EXISTS idx_work_order_created_at;
-- DROP INDEX IF EXISTS idx_work_site_created_at;
-- DROP INDEX IF EXISTS idx_workflow_created_at;
