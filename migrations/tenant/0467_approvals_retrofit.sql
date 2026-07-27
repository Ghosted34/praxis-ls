-- ============================================================================
-- TENANT DB — 0467 Approvals retrofit (MOD-67)
-- Makes the universal emit-hook work for HR leave: registers the event type as
-- approvable and seeds a sensible default single-step workflow so a submitted
-- leave request appears in the central Approvals inbox. Idempotent + defensive
-- (the workflow/step seed can never block boot).
-- See doc/APPROVALS_WORKFLOW_ORG_PLAN.md.
-- ============================================================================

-- 1) Register the leave-request event as approvable (flag-only; safe). The row
--    may already exist from module registration — upsert the flag either way.
INSERT INTO event_type (key, module_key, name, is_approvable)
VALUES ('leave_allowance.created', 'MOD-15', 'Leave / allowance requested', true)
ON CONFLICT (key) DO UPDATE SET is_approvable = true;

-- 2) Seed a default "Leave approval" workflow + one APPROVE step routed to the
--    most appropriate management role available. Wrapped so any environment
--    difference (role codes, etc.) degrades to a no-op rather than failing the
--    migration run.
DO $$
DECLARE
  v_event  uuid;
  v_wf     uuid;
  v_role   uuid;
BEGIN
  SELECT event_type_id INTO v_event FROM event_type WHERE key = 'leave_allowance.created';
  IF v_event IS NULL THEN RETURN; END IF;

  -- Already configured? leave it alone.
  IF EXISTS (SELECT 1 FROM workflow WHERE event_type_id = v_event) THEN RETURN; END IF;

  -- Prefer an HR/management approver; fall back to any non-system role, then any.
  SELECT role_id INTO v_role FROM role
   ORDER BY (CASE WHEN code = 'HR_MANAGER' THEN 0
                  WHEN code = 'MANAGEMENT' THEN 1
                  WHEN code = 'CEO'        THEN 2
                  ELSE 3 END),
            is_system DESC
   LIMIT 1;

  INSERT INTO workflow (event_type_id, name, is_active)
  VALUES (v_event, 'Leave approval (default)', true)
  RETURNING workflow_id INTO v_wf;

  INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
  VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');
EXCEPTION WHEN OTHERS THEN
  -- Never let seed data block the schema migration.
  NULL;
END $$;
