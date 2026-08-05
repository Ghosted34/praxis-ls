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
-- WHY PLAIN `

-- ── 2026-08-05: made SELF-GUARDING after a live failure ─────────────────────
--
-- As shipped this was 130 flat `CREATE INDEX IF NOT EXISTS … (created_at)`
-- statements, and the table list was derived by PARSING THE MIGRATION DDL.
-- That is the premise that turned out to be false: the migration files and the
-- live schema have already drifted (audit DATA 3.3), so a table that declares
-- `created_at` in a migration does not necessarily have it on a real tenant.
--
-- The observed failure:
--
--     Failed applying tenant/0496_created_at_indexes.sql [live]:
--     column "created_at" does not exist
--
-- and because the migrator sends the file as ONE implicit transaction, that one
-- bad statement rolled back all 130 indexes and wedged the tenant — every
-- later migration for it fails behind this one.
--
-- SAFE TO EDIT IN PLACE, and this is the only situation where that is true:
-- `applyTracked` records the ledger row AFTER the file succeeds, so a file that
-- FAILED has no ledger row anywhere. Tenants where it already succeeded are
-- recorded and will never re-run it; tenants where it failed get this version.
-- (Contrast 0467/0468 in DATA 3.6, which SUCCEEDED while doing nothing — those
-- needed a new file precisely because the ledger already claims them.)
--
-- Each index is now created only if the column genuinely exists, and every skip
-- RAISES NOTICE naming the table — so the drift is reported rather than either
-- crashing the fleet or being silently swallowed. That is deliberately NOT
-- `EXCEPTION WHEN OTHERS THEN NULL`: the precondition is tested explicitly and
-- anything unexpected still aborts.
--
-- ROLLBACK: every object here is an index.
--   DROP INDEX IF EXISTS idx_<table>_created_at;   -- for each table below

DO $$
DECLARE
  tbl     text;
  tables  text[] := ARRAY[
    'access_review', 'accounting_period', 'advance',
    'ai_action_catalogue', 'ai_action_run', 'ai_budget_period',
    'ai_chunk', 'ai_conversation', 'ai_document',
    'ai_feature_flag', 'ai_message', 'ai_vendor_credential',
    'app_user', 'appraisal', 'approval_task',
    'approval_token', 'asset', 'attendance_log',
    'campaign_sender', 'campaign_template', 'cash_request',
    'chart_of_accounts', 'client_master', 'comms_attachment',
    'comms_group', 'comms_message', 'comms_quick_reply',
    'comms_reaction', 'comms_star', 'compliance_flag',
    'contact_enquiry', 'corporate_entity', 'cost_entry',
    'costing', 'cycle_count', 'debt_engagement',
    'delivery_note', 'dictionary_item', 'document_signature',
    'document_vault', 'dossier', 'driver_license',
    'email_attachment', 'email_connection', 'email_identity',
    'employee', 'employee_earning', 'event_dispatch',
    'event_log', 'event_type', 'execution_card',
    'expense_rate', 'extra_charge_simulation', 'fleet_claim',
    'fleet_dispatch', 'fleet_incident', 'fuel_log',
    'geo_place', 'goods_received_note', 'grn_inbound',
    'help_article', 'hr_contract', 'hr_query',
    'hr_sanction', 'immutable_ledger', 'inventory_item',
    'invoice', 'job_applicant', 'journal_entry',
    'kpi_target', 'lead', 'leave_request',
    'margin_simulation', 'marketing_campaign', 'meeting',
    'meeting_note', 'milestone_instance', 'milestone_template',
    'notification', 'notification_preference', 'onboarding_checklist',
    'opportunity', 'outbound_order', 'partnership_request',
    'password_reset', 'payment_gateway', 'payment_receipt',
    'payroll_run', 'portal_access', 'portal_invite',
    'portal_user', 'posting_rule', 'proposal',
    'purchase_order', 'purchase_request', 'push_subscription',
    'q_ticket', 'quotation', 'regie_advance',
    'reminder', 'role', 'saved_report',
    'scheduled_report', 'scope', 'service_type',
    'sop_document', 'success_story', 'succession_plan',
    'supplier_invoice', 'supplier_master', 'talent_pool',
    'tax_calendar', 'tax_code', 'tax_declaration',
    'tax_jurisdiction', 'training', 'transit_order',
    'treasury_account', 'user_device', 'user_session',
    'vacancy', 'vehicle', 'vehicle_compliance',
    'wms_equipment', 'work_order', 'work_site',
    'workflow'
  ];
  idx     text;
  made    int := 0;
  skipped int := 0;
  missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- The table itself may not exist on every tenant either (modules ship at
    -- different times), which is equally not a reason to fail the fleet.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name   = tbl
         AND column_name  = 'created_at'
    ) THEN
      skipped := skipped + 1;
      missing := missing || tbl;
      CONTINUE;
    END IF;

    idx := format('idx_%s_created_at', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = current_schema() AND indexname = idx
    ) THEN
      EXECUTE format('CREATE INDEX %I ON %I.%I (created_at)', idx, current_schema(), tbl);
      made := made + 1;
    END IF;
  END LOOP;

  IF skipped > 0 THEN
    -- Loud, because this is schema drift (DATA 3.3) and somebody should look:
    -- the migration files say these tables have created_at and the database
    -- disagrees.
    RAISE WARNING '[0496] %: % table(s) have no created_at column and were skipped — MIGRATION FILES AND LIVE SCHEMA HAVE DRIFTED (DATA 3.3): %',
      current_schema(), skipped, array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE '[0496] %: % created_at index(es) created, % skipped.',
    current_schema(), made, skipped;
END $$;
