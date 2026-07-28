-- ============================================================================
-- TENANT DB — 0474 tag notifications with a category. Notifications are written
-- keyed by a fine-grained event_type_key; the Preferences UI and the per-user
-- opt-out check work in terms of coarse CATEGORIES (security/finance/…). Storing
-- the derived category on each row lets the inbox filter by it and keeps the
-- preference-enforcement key (channel, category) consistent with what was shown
-- to the user. Producers set it via src/shared/notifications/categories.js.
-- Existing rows are back-filled from their event_type_key's leading segment.
-- ============================================================================
ALTER TABLE notification ADD COLUMN IF NOT EXISTS category text;

-- Best-effort back-fill for rows written before this column existed. Mirrors the
-- DOMAIN_TO_CATEGORY map in categories.js for the common domains; anything else
-- becomes 'system'. New writes set category explicitly, so this only touches history.
UPDATE notification SET category = CASE
  WHEN split_part(event_type_key, '.', 1) IN
    ('auth','permission','role','field_visibility','capability','app_user','audit_ledger','session','scope','setting','iam','godmode','numbering_setting') THEN 'security'
  WHEN split_part(event_type_key, '.', 1) IN
    ('approval','workflow','costing','cash_request','disbursal','advance') THEN 'approvals'
  WHEN split_part(event_type_key, '.', 1) IN
    ('invoice','payment','journal','gl','account','credit_note','proforma','debt','period','tax_declaration','asset','payroll','fx','cost') THEN 'finance'
  WHEN split_part(event_type_key, '.', 1) IN
    ('dossier','delivery_note','grn','po','cycle_count','milestone','vehicle','driver','attendance','supplier','supplier_invoice','employee','appraisal','procurement','wms','fleet','operations','master') THEN 'operations'
  WHEN split_part(event_type_key, '.', 1) IN
    ('client','lead','campaign','contact_enquiry','quote','sales','commercial') THEN 'sales'
  WHEN split_part(event_type_key, '.', 1) IN
    ('compliance_flag','document','document_vault','vault') THEN 'compliance'
  ELSE 'system'
END
WHERE category IS NULL;

CREATE INDEX IF NOT EXISTS ix_notif_user_category ON notification (user_id, category);
