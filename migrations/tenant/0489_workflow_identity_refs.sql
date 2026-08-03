-- ============================================================================
-- TENANT DB — 0489 Drop the unsatisfiable cross-schema FKs on workflow_step /
-- approval_task (role_id, scope_id)
--
-- THE PROBLEM. Since session 3, identity is pinned to the LIVE schema: `role`,
-- `scope`, `app_user` and their joins are read and written through
-- req.identityDb no matter which environment the user is viewing, so a person's
-- roles and their place in the company don't change when they flip LIVE/TEST.
-- Business data still writes to the env-selected schema through req.tenantDb.
--
-- `workflow`, `workflow_step` and `approval_task` are business data. So under
-- TEST they are written to `sandbox.*`, while the role and scope ids the UI
-- offers come from `live.*`. The declared foreign keys
--
--     workflow_step.role_id    REFERENCES role(role_id)
--     workflow_step.scope_id   REFERENCES scope(scope_id)
--     approval_task.assigned_role_id REFERENCES role(role_id)
--
-- resolve inside the writing schema, so under TEST they check `sandbox.role`
-- (seeded separately by 9020, so the SAME role codes carry DIFFERENT uuids) and
-- `sandbox.scope` (never written at all, because scopes are identity data —
-- always empty). Both fail with 23503 "Referenced record not found" on a value
-- that is perfectly valid.
--
-- This is the same shape as the bug that made TEST-mode writes fail for fourteen
-- sessions (60+ columns REFERENCES app_user), and the same shape as
-- scope.entity_id → corporate_entity, fixed 2026-08-02 by pointing the picker at
-- the schema the constraint checks.
--
-- WHY DROP RATHER THAN MIRROR. `app_user` was fixed by mirroring live rows into
-- sandbox (shared/db/sandbox-user-mirror.js). That does not work here:
-- `role` has UNIQUE (code) and 9020 already seeds every role into BOTH schemas,
-- so mirroring live roles would hit the conflict, insert nothing, and leave the
-- FK just as unsatisfied — silently. Mirroring `scope` would work but would make
-- the organigramme environment-specific, which is precisely what pinning
-- identity to live was meant to prevent.
--
-- The constraints also buy nothing. Eligibility is decided in code against
-- identity data — services/workflow/executor.js assertEligible() compares the
-- step's role against the caller's role_ids from their session, and the step's
-- scope against their scope closure resolved on the identity client. The FK
-- cannot participate in that check because it is looking at the wrong schema.
-- Same reasoning as `dossier.service_type_id` (a plain FK) and as the guarded
-- sub-selects in shared/events/emit.js, which record an event and drop the
-- attribution rather than fail when an actor id can't be validated.
--
-- The app_user references (approval_task.assigned_user_id, acted_by,
-- event_log.actor_user_id) are deliberately LEFT IN PLACE: the sandbox user
-- mirror makes them satisfiable, so they still do their job.
--
-- Constraint names are discovered rather than assumed — Postgres's generated
-- name is predictable but these tables predate several renames.
-- Idempotent: skips anything already dropped.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname, rel.relname
      FROM pg_constraint con
      JOIN pg_class      rel ON rel.oid = con.conrelid
      JOIN pg_namespace  nsp ON nsp.oid = rel.relnamespace
      JOIN pg_class      ref ON ref.oid = con.confrelid
     WHERE con.contype = 'f'
       AND nsp.nspname = current_schema()
       AND (
             (rel.relname = 'workflow_step'  AND ref.relname IN ('role', 'scope'))
          OR (rel.relname = 'workflow'       AND ref.relname IN ('role', 'scope'))
          OR (rel.relname = 'approval_task'  AND ref.relname = 'role')
           )
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.relname, r.conname);
    RAISE NOTICE '[0489] dropped %.% (cross-schema identity reference)', r.relname, r.conname;
  END LOOP;
END $$;

COMMENT ON COLUMN workflow_step.role_id IS
  'Role that may act on this step. Identity data (live schema) — no FK on purpose, see 0489. Validated in code.';
COMMENT ON COLUMN workflow_step.scope_id IS
  'Organigramme node this step belongs to. Identity data (live schema) — no FK on purpose, see 0489.';
COMMENT ON COLUMN approval_task.assigned_role_id IS
  'Copied from the step. Identity data (live schema) — no FK on purpose, see 0489.';
