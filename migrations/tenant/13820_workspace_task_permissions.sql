-- ============================================================================
-- TENANT DB — 13820 My Workspace: who may write, and the event vocabulary.
--
-- Companion to 13810, which created the tables. This file grants the authority
-- to write to them and registers the events they emit. It is a separate
-- migration rather than part of 13810 because the two answer different
-- questions: 13810 is shape, this is policy — and a tenant operator reading
-- their grants should be able to find the second without wading through DDL.
--
-- ── MOD-00A STOPS BEING READ-ONLY, AND THAT IS THE POINT ───────────────────
--
-- 9022 seeded MOD-00A as `false,true,false,false,false` with the comment
-- "Read for everyone; there is no write surface". That was accurate when the
-- workspace could only SHOW other modules' work. It now has tasks and a
-- calendar, which are things a person writes, so the write columns have to
-- become true — and the comment in 9022 is amended to say so rather than left
-- to contradict this file.
--
-- ── WHO GETS WHAT, AND WHY ─────────────────────────────────────────────────
--
--   create + update   EVERY ROLE.
--     A to-do list you cannot write to is a report. The audience rules in
--     tasks.service.js already decide whose work you can SEE; being able to
--     write your own is not a privilege to be rationed. Update is likewise
--     broad because the service only lets a caller touch a task they can see —
--     which is one they wrote, one assigned to them, or one inside their scope.
--
--   delete            SUPER_ADMIN AND CEO ONLY.
--     Deliberately the narrow column. Deleting a task is removing somebody's
--     record that work exists, and the two roles that can also undo a mistake
--     in the audit ledger are the two that should hold it. A task is
--     SOFT-deleted (13810), so this is reversible at the row — but "reversible
--     by a DBA" is not the same as "reversible by the person who clicked it",
--     and the difference is why the grant is narrow. Widen per tenant from the
--     permission matrix if a tenant wants managers clearing their team's lists.
--
--   approve           stays false. Nothing here goes through a workflow.
--
-- ── WHY AN UPDATE AND NOT A NEW MODULE KEY ─────────────────────────────────
--
-- Tasks and events could have been their own MOD-xx, which would give each a
-- kill switch in the feature matrix. They are not, because they ARE the
-- workspace: an administrator who can turn off "My workspace" but not its
-- calendar has a switch that does half a job, and one who turns the workspace
-- off has turned off the thing the tasks live in. One key, one grant, one
-- place to look. The cost is that there is no calendar-only off switch, which
-- is a real limitation and a deliberate one.
--
-- ── WHY THE EVENT ROWS ARE HERE AND NOT IN 9020 ────────────────────────────
--
-- 9020 is a plain INSERT with no ON CONFLICT: it is the fresh-provision seed
-- and runs once, before any tenant exists. Adding rows to it would register
-- these event types on NEW tenants only, leaving every existing tenant with
-- `emitEvent` raising 23502 on the first task created. A tenant migration runs
-- everywhere, which is the only way both populations end up the same.
--
-- Idempotent: ON CONFLICT DO NOTHING throughout, so a re-run is safe and a
-- tenant that has tuned its own grants keeps them.
-- ============================================================================

-- ── 1. WRITE AUTHORITY ─────────────────────────────────────────────────────

-- Everyone may write their own work. `role` is joined rather than listed so a
-- tenant's custom roles get the same default as the seeded ones — a role
-- created after this migration would otherwise arrive with no workspace grant
-- at all and be unable to use the page they can see in the ribbon.
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, 'MOD-00A', true, true, true, false, false
FROM role r
ON CONFLICT (role_id, module_key) DO UPDATE
  SET can_create = true,
      can_read   = true,
      can_update = true;

-- Delete stays with the two roles that can put things back.
INSERT INTO permission (role_id, module_key, can_create, can_read, can_update, can_delete, can_approve)
SELECT r.role_id, 'MOD-00A', true, true, true, true, false
FROM role r
WHERE r.code IN ('SUPER_ADMIN', 'CEO')
ON CONFLICT (role_id, module_key) DO UPDATE
  SET can_create = true,
      can_read   = true,
      can_update = true,
      can_delete = true;

-- ── 2. EVENT VOCABULARY ────────────────────────────────────────────────────
--
-- `emitEvent` resolves its key against this catalogue, so a key with no row is
-- a failed write, not a silent one. None of these is security-critical (a task
-- is not a permission change) and none is approvable (nothing here drives a
-- workflow), so both flags are false everywhere.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('task.created',              'MOD-00A', 'Workspace task created',            false, false),
 ('task.updated',              'MOD-00A', 'Workspace task updated',            false, false),
 ('task.status_changed',       'MOD-00A', 'Workspace task moved',              false, false),
 ('task.assigned',             'MOD-00A', 'Workspace task assigned',           false, false),
 ('task.deleted',              'MOD-00A', 'Workspace task deleted',            false, false),
 ('task.reminder_due',         'MOD-00A', 'Workspace task reminder fired',     false, false),
 ('calendar_event.created',    'MOD-00A', 'Calendar event created',            false, false),
 ('calendar_event.updated',    'MOD-00A', 'Calendar event updated',            false, false),
 ('calendar_event.deleted',    'MOD-00A', 'Calendar event deleted',            false, false),
 ('calendar_event.reminder_due','MOD-00A','Calendar event reminder fired',     false, false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   -- every role can now write, and only two can delete
--   SELECT r.code, p.can_create, p.can_update, p.can_delete
--     FROM permission p JOIN role r USING (role_id)
--    WHERE p.module_key = 'MOD-00A' ORDER BY r.code;
--   -- the events the module emits all resolve
--   SELECT count(*) FROM event_type WHERE module_key = 'MOD-00A';  -- 10
--
-- DOWN
--   DELETE FROM event_type WHERE module_key = 'MOD-00A';
--   UPDATE permission SET can_create = false, can_update = false, can_delete = false
--     WHERE module_key = 'MOD-00A';
--   -- My Workspace becomes read-only again; every task write returns 403.
-- ============================================================================
