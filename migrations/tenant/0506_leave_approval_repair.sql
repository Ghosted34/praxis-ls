-- 0506 — Repair what 0467/0468 may have silently failed to do, and say so
--        out loud this time (DATA 3.6).
--
-- 0467_approvals_retrofit.sql and 0468_leave_approval_backfill.sql both end
-- their DO blocks with:
--
--     EXCEPTION WHEN OTHERS THEN
--       NULL;
--
-- so ANY failure inside — a missing role table, a constraint violation, a
-- column that does not exist on that tenant — was discarded. The migration then
-- recorded SUCCESS in `schema_migration`, and the tenant was left without the
-- leave-approval workflow it was supposed to get.
--
-- WHY THAT MATTERS, concretely: with no workflow bound to
-- `leave_allowance.created`, `executor.start()` returns `autoApproved`, and the
-- calling module discards that flag. The leave request never finalises and
-- never appears in the approvals queue. It is not rejected — it simply sits
-- there, and nothing anywhere reports a problem. That is the failure mode
-- audit W8/W11 describes, and 0492 already fixed the identical defect in
-- 0469 for the other six approvable events.
--
-- WHY A NEW FILE RATHER THAN AN EDIT: the migrator keys the ledger on filename
-- (DATA 3.1), so editing an applied migration never re-runs it. 0467 and 0468
-- are applied everywhere. The only way to reach an affected tenant is a new
-- file. Same reasoning 0492 gives.
--
-- This file takes the treatment 0492 established, which is the right one:
--
--   * IDEMPOTENT — it only creates what is missing, so it is a no-op on a
--     tenant where 0467/0468 actually worked. Safe to re-run.
--   * RAISE WARNING, NOT SILENCE — a convenience seed must not block a deploy,
--     so failure is still non-fatal. But it is now AUDIBLE: the warning names
--     the tenant schema and the SQLSTATE, so `docker compose logs` after a
--     deploy shows which tenants need attention instead of nothing at all.
--   * NARROW EXCEPTION SCOPE — the handler wraps only the seeding work. It
--     does not sit around DDL, so a genuine schema error still aborts.
--
-- ROLLBACK: this file only inserts rows that were already supposed to exist.
--   DELETE FROM approval_task
--    WHERE entity_ref LIKE 'leave_allowance:%' AND status = 'PENDING';
--   DELETE FROM workflow_step WHERE workflow_id IN (
--     SELECT workflow_id FROM workflow w
--      JOIN event_type et ON et.event_type_id = w.event_type_id
--      WHERE et.key = 'leave_allowance.created');
--   DELETE FROM workflow WHERE event_type_id IN (
--     SELECT event_type_id FROM event_type WHERE key = 'leave_allowance.created');

DO $$
DECLARE
  v_event uuid;
  v_wf    uuid;
  v_step  uuid;
  v_role  uuid;
  v_tasks int := 0;
  v_made_wf boolean := false;
BEGIN
  SELECT event_type_id INTO v_event
    FROM event_type WHERE key = 'leave_allowance.created';

  IF v_event IS NULL THEN
    RAISE WARNING '[0506] %: event_type ''leave_allowance.created'' is absent — 0467 did not complete here. Leave approvals cannot be wired until it exists.', current_schema();
    RETURN;
  END IF;

  -- ── the workflow ──
  SELECT workflow_id INTO v_wf
    FROM workflow
   WHERE event_type_id = v_event AND is_active = true
   ORDER BY created_at
   LIMIT 1;

  IF v_wf IS NULL THEN
    SELECT role_id INTO v_role FROM role
     ORDER BY (CASE WHEN code = 'HR_MANAGER' THEN 0
                    WHEN code = 'MANAGEMENT' THEN 1
                    WHEN code = 'CEO'        THEN 2
                    ELSE 3 END), is_system DESC
     LIMIT 1;

    IF v_role IS NULL THEN
      RAISE WARNING '[0506] %: no role exists to approve leave — workflow not created. Seed roles, then re-run this file.', current_schema();
      RETURN;
    END IF;

    INSERT INTO workflow (event_type_id, name, is_active)
    VALUES (v_event, 'Leave approval (default)', true)
    RETURNING workflow_id INTO v_wf;

    INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
    VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');

    v_made_wf := true;
    RAISE WARNING '[0506] %: leave-approval workflow was MISSING and has been created. 0467/0468 failed silently on this tenant.', current_schema();
  END IF;

  -- ── the backfill ──
  SELECT workflow_step_id INTO v_step
    FROM workflow_step WHERE workflow_id = v_wf ORDER BY step_seq LIMIT 1;

  IF v_step IS NULL THEN
    RAISE WARNING '[0506] %: workflow % has no step — cannot open approval tasks.', current_schema(), v_wf;
    RETURN;
  END IF;

  SELECT role_id INTO v_role FROM workflow_step WHERE workflow_step_id = v_step;

  INSERT INTO approval_task (workflow_id, workflow_step_id, entity_ref, assigned_role_id, status)
  SELECT v_wf, v_step, 'leave_allowance:' || lr.leave_request_id, v_role, 'PENDING'
    FROM leave_request lr
   WHERE lr.status = 'REQUESTED'
     AND NOT EXISTS (
       SELECT 1 FROM approval_task at
        WHERE at.entity_ref = 'leave_allowance:' || lr.leave_request_id
          AND at.status = 'PENDING'
     );
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  IF v_tasks > 0 THEN
    RAISE WARNING '[0506] %: opened % missing leave approval task(s). Those requests were invisible to the approvals queue.',
                  current_schema(), v_tasks;
  ELSIF NOT v_made_wf THEN
    RAISE NOTICE '[0506] %: leave approvals already correct, nothing to repair.',
                 current_schema();
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Still non-fatal — a seed must not block a deploy — but NEVER silent again.
  -- This is the whole of DATA 3.6: the same tolerance, with the failure named.
  RAISE WARNING '[0506] %: leave-approval repair FAILED: % (SQLSTATE %). Leave requests on this tenant may never reach the approvals queue. Investigate before the next deploy.',
                current_schema(), SQLERRM, SQLSTATE;
END $$;
