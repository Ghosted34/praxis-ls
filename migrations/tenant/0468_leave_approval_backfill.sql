-- ============================================================================
-- TENANT DB — 0468 Leave approval backfill (MOD-67)
-- 0467 wired NEW leave requests into the Approvals inbox via the emit-hook, but
-- requests submitted BEFORE the workflow existed have no approval_task (tasks are
-- only opened on emit, not retroactively). This backfills them, and re-asserts
-- the event-type flag + default workflow so it works even if 0467 partially ran.
-- Fully idempotent + defensive (never blocks boot).
-- ============================================================================

INSERT INTO event_type (key, module_key, name, is_approvable)
VALUES ('leave_allowance.created', 'MOD-15', 'Leave / allowance requested', true)
ON CONFLICT (key) DO UPDATE SET is_approvable = true;

DO $$
DECLARE
  v_event uuid;
  v_wf    uuid;
  v_step  uuid;
  v_role  uuid;
BEGIN
  SELECT event_type_id INTO v_event FROM event_type WHERE key = 'leave_allowance.created';
  IF v_event IS NULL THEN RETURN; END IF;

  -- Ensure a default workflow + one APPROVE step exists.
  SELECT workflow_id INTO v_wf FROM workflow WHERE event_type_id = v_event AND is_active = true ORDER BY created_at LIMIT 1;
  IF v_wf IS NULL THEN
    SELECT role_id INTO v_role FROM role
     ORDER BY (CASE WHEN code = 'HR_MANAGER' THEN 0
                    WHEN code = 'MANAGEMENT' THEN 1
                    WHEN code = 'CEO'        THEN 2
                    ELSE 3 END), is_system DESC
     LIMIT 1;
    INSERT INTO workflow (event_type_id, name, is_active)
    VALUES (v_event, 'Leave approval (default)', true) RETURNING workflow_id INTO v_wf;
    INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
    VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');
  END IF;

  SELECT workflow_step_id INTO v_step FROM workflow_step WHERE workflow_id = v_wf ORDER BY step_seq LIMIT 1;
  SELECT role_id INTO v_role FROM workflow_step WHERE workflow_step_id = v_step;

  -- Backfill: open a pending task for every REQUESTED leave with no live task.
  INSERT INTO approval_task (workflow_id, workflow_step_id, entity_ref, assigned_role_id, status)
  SELECT v_wf, v_step, 'leave_allowance:' || lr.leave_request_id, v_role, 'PENDING'
    FROM leave_request lr
   WHERE lr.status = 'REQUESTED'
     AND NOT EXISTS (
       SELECT 1 FROM approval_task at
        WHERE at.entity_ref = 'leave_allowance:' || lr.leave_request_id AND at.status = 'PENDING'
     );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
