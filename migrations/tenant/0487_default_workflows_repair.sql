-- ============================================================================
-- TENANT DB — 0487 Default approval workflows: repair + audible failure (MOD-67)
--
-- 0469_default_workflows.sql seeds a single-step APPROVE workflow for the six
-- events whose modules call executor.start(). Two problems with it, neither
-- fixable in place (it is applied everywhere and the migrator keys on filename,
-- so editing it would never re-run — see SESSION_HANDOFF.md):
--
--   1. It ends `EXCEPTION WHEN OTHERS THEN NULL`. If anything inside failed, the
--      migration reported success and left the tenant with NO workflows bound.
--      That is the worst possible outcome to hide, because a missing workflow
--      makes executor.start() return autoApproved and five of the six calling
--      modules discard that flag — so the record silently never finalises and
--      never appears in the approvals queue (audit finding W8/W11). This file
--      RAISES WARNING instead: still non-fatal, because a convenience seed must
--      not block a deploy, but never again silent.
--
--   2. It picked ONE role for all six workflows — FINANCE, else MANAGEMENT, else
--      CEO, else any — so payroll, procurement and invoicing all routed to the
--      same approver at every value. Below, each event gets the role that
--      actually owns it, falling back the same way when a tenant has deleted or
--      renamed the seeded roles.
--
-- Idempotent and non-destructive: only creates a workflow for an approvable
-- event that has NONE. A tenant that already has 0469's workflows keeps them
-- untouched, including any retuning done in the designer. Re-runnable.
--
-- NOTE this does not give the steps a scope_id. Scope-based routing (the
-- organigramme dimension) needs the step designer to grow a scope picker first;
-- a null scope means tenant-wide, which is the correct default for a seed.
-- ============================================================================

DO $$
DECLARE
  r          RECORD;
  v_wf       uuid;
  v_role     uuid;
  v_fallback uuid;
  v_made     integer := 0;
BEGIN
  -- Fallback approver, used when a tenant has no role matching the preferred
  -- code for an event. Same precedence 0469 used.
  SELECT role_id INTO v_fallback FROM role
   ORDER BY (CASE WHEN code = 'FINANCE'    THEN 0
                  WHEN code = 'MANAGEMENT' THEN 1
                  WHEN code = 'CEO'        THEN 2
                  ELSE 3 END), is_system DESC
   LIMIT 1;

  IF v_fallback IS NULL THEN
    RAISE WARNING '[0487] no roles exist in this schema — default approval workflows not seeded';
    RETURN;
  END IF;

  FOR r IN
    SELECT et.event_type_id, et.key, et.name, v.preferred
      FROM event_type et
      JOIN (VALUES ('costing.submitted',        'FINANCE'),
                   ('invoice.issued',           'FINANCE'),
                   ('disbursal.requested',      'FINANCE'),
                   ('po.issued',                'PROCUREMENT'),
                   ('supplier_invoice.matched', 'PROCUREMENT'),
                   ('payroll.status_changed',   'HR')
           ) AS v(key, preferred) ON v.key = et.key
     WHERE et.is_approvable = true
       AND NOT EXISTS (SELECT 1 FROM workflow w WHERE w.event_type_id = et.event_type_id)
  LOOP
    BEGIN
      SELECT role_id INTO v_role FROM role WHERE code = r.preferred LIMIT 1;
      IF v_role IS NULL THEN
        v_role := v_fallback;
        RAISE WARNING '[0487] no % role — % falls back to the default approver', r.preferred, r.key;
      END IF;

      INSERT INTO workflow (event_type_id, name, is_active)
      VALUES (r.event_type_id, COALESCE(r.name, r.key) || ' — approval (default)', true)
      RETURNING workflow_id INTO v_wf;

      INSERT INTO workflow_step (workflow_id, step_seq, step_kind, role_id, capability_code)
      VALUES (v_wf, 1, 'APPROVE', v_role, 'APPROVER');

      v_made := v_made + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Per-event, so one bad event cannot cost the other five. Non-fatal, but
      -- named and logged — this is the line 0469 got wrong.
      RAISE WARNING '[0487] could not seed default workflow for %: %', r.key, SQLERRM;
    END;
  END LOOP;

  IF v_made > 0 THEN
    RAISE NOTICE '[0487] seeded % default approval workflow(s)', v_made;
  END IF;
END $$;
