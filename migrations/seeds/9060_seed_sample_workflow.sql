-- ============================================================================
-- SEED (per tenant schema) — a SAMPLE approval workflow for final invoices.
-- Shipped INACTIVE (is_active=false) so it never blocks a fresh tenant (unbound
-- events auto-post); it is a template the tenant activates/edits from the
-- Workflow designer (doc/BUILD_CONVENTIONS.md §2/§6). Steps reference seeded
-- roles by code. Guarded so it seeds at most once per event.
-- ============================================================================

WITH w AS (
  INSERT INTO workflow (event_type_id, name, is_active)
  SELECT et.event_type_id, 'Final invoice approval (sample)', false
    FROM event_type et
   WHERE et.key = 'invoice.issued'
     AND NOT EXISTS (SELECT 1 FROM workflow x WHERE x.event_type_id = et.event_type_id)
  RETURNING workflow_id
)
INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code, min_amount_xaf, max_amount_xaf)
SELECT w.workflow_id, 1, 'VALIDATE', (SELECT role_id FROM role WHERE code = 'FINANCE'), 'VALIDATOR', NULL::numeric, NULL::numeric FROM w
UNION ALL
SELECT w.workflow_id, 2, 'APPROVE',  (SELECT role_id FROM role WHERE code = 'CEO'),     'APPROVER',  NULL::numeric, NULL::numeric FROM w;

-- Purchase order approval (sample, inactive) — bound to po.issued.
WITH w AS (
  INSERT INTO workflow (event_type_id, name, is_active)
  SELECT et.event_type_id, 'Purchase order approval (sample)', false
    FROM event_type et
   WHERE et.key = 'po.issued'
     AND NOT EXISTS (SELECT 1 FROM workflow x WHERE x.event_type_id = et.event_type_id)
  RETURNING workflow_id
)
INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code, min_amount_xaf, max_amount_xaf)
SELECT w.workflow_id, 1, 'VALIDATE', (SELECT role_id FROM role WHERE code = 'PROCUREMENT'), 'VALIDATOR', NULL::numeric, NULL::numeric FROM w
UNION ALL
SELECT w.workflow_id, 2, 'APPROVE',  (SELECT role_id FROM role WHERE code = 'CEO'),         'APPROVER',  NULL::numeric, NULL::numeric FROM w;

-- Payroll run approval (sample, inactive) — bound to payroll.status_changed.
WITH w AS (
  INSERT INTO workflow (event_type_id, name, is_active)
  SELECT et.event_type_id, 'Payroll run approval (sample)', false
    FROM event_type et
   WHERE et.key = 'payroll.status_changed'
     AND NOT EXISTS (SELECT 1 FROM workflow x WHERE x.event_type_id = et.event_type_id)
  RETURNING workflow_id
)
INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code, min_amount_xaf, max_amount_xaf)
SELECT w.workflow_id, 1, 'VALIDATE', (SELECT role_id FROM role WHERE code = 'HR'),      'VALIDATOR', NULL::numeric, NULL::numeric FROM w
UNION ALL
SELECT w.workflow_id, 2, 'APPROVE',  (SELECT role_id FROM role WHERE code = 'FINANCE'), 'APPROVER',  NULL::numeric, NULL::numeric FROM w;
