-- ============================================================================
-- TENANT DB — 0491 Purchase requests join the approval engine
--
-- A purchase request is, literally, a request for approval to buy something.
-- The module has APPROVED and REJECTED states and the screen has an "Approved"
-- KPI tile — so somebody expected it to route. Nothing did: purchase_request
-- was the only such document that never called executor.start, so submitting
-- one created no approval task, notified nobody, and left it waiting for a
-- manual status change by whoever happened to look.
--
-- This registers the event, so the tenant can bind a chain to it in the Workflow
-- designer, and seeds a single-step default so it works out of the box — same
-- shape as 0469/0487 for the other six.
--
-- `pr.submitted` is approvable; `pr.approved` is recorded but not approvable
-- (it is the outcome, not a decision point), matching costing.submitted /
-- costing.approved above it in 9020.
--
-- Idempotent: ON CONFLICT on the event key, and the workflow is only created if
-- that event has none.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('pr.submitted','MOD-62','Purchase request submitted',false,true),
 ('pr.approved','MOD-62','Purchase request approved',false,false)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  v_event uuid;
  v_role  uuid;
  v_wf    uuid;
BEGIN
  SELECT event_type_id INTO v_event FROM event_type WHERE key = 'pr.submitted';
  IF v_event IS NULL THEN
    RAISE WARNING '[0491] pr.submitted missing — default workflow not seeded';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM workflow WHERE event_type_id = v_event) THEN
    RETURN; -- already configured; never overwrite a tenant's own chain
  END IF;

  -- Procurement owns purchase requests; fall back the same way 0487 does.
  SELECT role_id INTO v_role FROM role
   ORDER BY (CASE WHEN code = 'PROCUREMENT' THEN 0
                  WHEN code = 'MANAGEMENT'  THEN 1
                  WHEN code = 'FINANCE'     THEN 2
                  WHEN code = 'CEO'         THEN 3
                  ELSE 4 END), is_system DESC
   LIMIT 1;

  IF v_role IS NULL THEN
    RAISE WARNING '[0491] no roles in this schema — default workflow not seeded';
    RETURN;
  END IF;

  INSERT INTO workflow (event_type_id, name, is_active)
  VALUES (v_event, 'Purchase request — approval (default)', true)
  RETURNING workflow_id INTO v_wf;

  INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
  VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');

  RAISE NOTICE '[0491] seeded the default purchase-request approval chain';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[0491] could not seed the purchase-request workflow: %', SQLERRM;
END $$;
