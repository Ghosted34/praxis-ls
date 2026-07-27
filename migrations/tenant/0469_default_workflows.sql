-- ============================================================================
-- TENANT DB — 0469 Default approval workflows (MOD-67)
-- The finance / procurement / payroll modules already open approval tasks
-- (executor.start) and register finalize handlers, but with no workflow bound
-- they auto-approve and never reach the inbox. This seeds a sensible default
-- single-step APPROVE workflow for each of those already-approvable, already-
-- integrated events, so the central Approvals queue covers the whole system —
-- not just leave. Idempotent (skips events already configured) + defensive
-- (never blocks boot). Admins can retune/disable these in the Workflow designer.
--   costing.submitted        → costing:<id>          (costing)
--   invoice.issued           → invoice:<id>          (final invoice)
--   disbursal.requested      → cash_request:<id>     (cash request)
--   po.issued                → purchase_order:<id>   (purchase order)
--   supplier_invoice.matched → supplier_invoice:<id> (supplier invoice)
--   payroll.status_changed   → payroll_run:<id>      (payroll run)
-- ============================================================================

DO $$
DECLARE
  v_role uuid;
  r      RECORD;
  v_wf   uuid;
BEGIN
  -- Prefer a finance/management approver; fall back to any role.
  SELECT role_id INTO v_role FROM role
   ORDER BY (CASE WHEN code = 'FINANCE'    THEN 0
                  WHEN code = 'MANAGEMENT' THEN 1
                  WHEN code = 'CEO'        THEN 2
                  ELSE 3 END), is_system DESC
   LIMIT 1;

  FOR r IN
    SELECT et.event_type_id, et.key, et.name
      FROM event_type et
     WHERE et.key IN (
             'costing.submitted', 'invoice.issued', 'disbursal.requested',
             'po.issued', 'supplier_invoice.matched', 'payroll.status_changed'
           )
       AND et.is_approvable = true
       AND NOT EXISTS (SELECT 1 FROM workflow w WHERE w.event_type_id = et.event_type_id)
  LOOP
    INSERT INTO workflow (event_type_id, name, is_active)
    VALUES (r.event_type_id, COALESCE(r.name, r.key) || ' — approval (default)', true)
    RETURNING workflow_id INTO v_wf;

    INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
    VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
