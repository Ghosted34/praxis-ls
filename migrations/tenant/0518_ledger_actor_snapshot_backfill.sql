-- ============================================================================
-- 0518 — Re-run the 0510 actor-snapshot back-fill.
--
-- WHY. 0510 added actor_name_snapshot/actor_email_snapshot to immutable_ledger
-- and back-filled every row that existed at the time. It did NOT fix the
-- writer: shared/crud/resource.js's makeService() create/update/archive (the
-- ~90 modules on the shared CRUD kit — corporate_entity's hand-rolled path
-- included, since it calls the same audit() helper directly) only ever passed
-- `actorUserId`, never `actorName`/`actorEmail`. So every row written by any
-- of those paths AFTER 0510 landed with NULL snapshot columns again, and the
-- Control Tower's self-scoped feed fell back to rendering the actor as a bare
-- `…<8 hex chars>` — e.g. "…3a5b4bba" instead of a name, on ordinary rows like
-- "You updated a corporate entity" or "You updated an applicant".
--
-- The writer is fixed alongside this migration (resource.js now sends
-- actorName/actorEmail on every create/update/archive), so this is a
-- ONE-TIME catch-up for the gap between 0510 and that fix — not a
-- recurring job. Safe to re-run: scoped to `actor_name_snapshot IS NULL`,
-- same as 0510, so a second application touches zero rows.
--
-- Written for the tenant-schema migrator, which applies this to BOTH `live`
-- and every tenant schema — same reasoning as 0510 (no shadow
-- `migrations/live/` in this repo).
--
-- trg_ledger_ro (0130_platform_projection.sql, forbid_mutation) fires on any
-- UPDATE regardless of which columns change, so this back-fill needs the same
-- scoped disable/enable bracket 0510 used.
-- ============================================================================

ALTER TABLE immutable_ledger DISABLE TRIGGER trg_ledger_ro;

UPDATE immutable_ledger l
   SET actor_name_snapshot  = u.full_name,
       actor_email_snapshot = u.email
  FROM app_user u
 WHERE l.actor_user_id       = u.user_id
   AND l.actor_name_snapshot IS NULL;

ALTER TABLE immutable_ledger ENABLE TRIGGER trg_ledger_ro;

-- DOWN
-- Not reversible in the meaningful sense (this only fills NULLs; nothing was
-- overwritten), and there is nothing to drop — no schema change, just data.
-- Left intentionally blank, matching 0510's own DOWN note for the same reason.
