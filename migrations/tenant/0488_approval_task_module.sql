-- ============================================================================
-- TENANT DB — 0488 approval_task.module_key: approval authority becomes
-- module-specific (MOD-67 → the module that owns the record)
--
-- WHY. POST /approvals/:id/act was gated on requirePermission('MOD-67',
-- 'approve') — MOD-67 being the IAM/RBAC engine. So the right to approve a
-- payroll run, a purchase order and a cash request was one and the same
-- permission, and it was the permission for administering IAM. In the default
-- grants that flag is seeded to CEO only (9021:52-59), so out of the box the CEO
-- was the only person who could act on any approval task no matter what chain a
-- tenant designed. Audit finding W3; "module specific" was the answer.
--
-- Recording the module ON THE TASK rather than deriving it at decision time from
-- the entity_ref prefix is deliberate. A prefix map would be a second registry
-- to keep in step with on-approved.js's handler map, and the two would drift
-- silently. Stored, the task carries the module it was opened under even if a
-- module later changes its ref convention, which also lets the approvals inbox
-- filter to "things I can actually approve" with a plain join.
--
-- NULLABLE, with the decision path falling back to MOD-67 when it is null. A
-- task with no resolvable module must not become unactionable — that would turn
-- a data gap into a stuck document, which is the failure mode this whole audit
-- was about.
--
-- Backfill resolves through the workflow's bound event type, which is where the
-- owning module is already recorded (event_type.module_key). Tasks whose
-- workflow or event type has since been deleted keep NULL and fall back.
-- ============================================================================

ALTER TABLE approval_task ADD COLUMN IF NOT EXISTS module_key citext;

UPDATE approval_task at
   SET module_key = et.module_key
  FROM workflow w
  JOIN event_type et ON et.event_type_id = w.event_type_id
 WHERE at.workflow_id = w.workflow_id
   AND at.module_key IS NULL
   AND et.module_key IS NOT NULL;

-- The inbox filters "pending, for a module I hold approve on", so the pending
-- index gains the column. Partial like the existing ix_approval_pending.
CREATE INDEX IF NOT EXISTS ix_approval_pending_module
    ON approval_task(module_key, status)
 WHERE status = 'PENDING';

COMMENT ON COLUMN approval_task.module_key IS
  'Module whose approve grant gates a decision on this task (0488). NULL falls back to MOD-67.';
