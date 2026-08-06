-- 0510 — Denormalise actor identity onto the ledger row.
--
-- WHY. The audit ledger stores `actor_user_id` (a uuid FK into `app_user`) and
-- has done since 0130. That was fine for a Governance-only reader that joins
-- back to /users for a name, but the new Control Tower widget
-- (`/audit/my-feed`, GET) needs to render a card without a second round-trip
-- to look up "who did this" — and there is no join path from the LIVE identity
-- schema into a SANDBOX ledger row anyway. So the actor's display name and
-- email are captured at write time on the row itself.
--
-- The two new attribute columns take the row's meaning beyond "an action
-- happened" without changing anything about the existing surface:
--
--   is_sensitive   the emitter's own judgement (God-Mode purge, break-glass
--                  role change) that this row deserves a "Sensitive" badge in
--                  the reader. Off by default so no historical row lights up.
--   metadata       jsonb bag for the free-form facts the humaniser wants
--                  (channel_name for a comms.message_posted, count for a bulk
--                  op) without piling more columns on. Empty object by
--                  default; the humaniser tolerates it being empty.
--
-- All four are ADDITIVE — no existing writer or reader has to change to keep
-- working, and back-fill covers rows written before the new columns existed.
--
-- Written for the tenant-schema migrator, which applies this to BOTH `live`
-- and every tenant schema (see src/services/platform/provisioning.service.js).
-- There is no shadow `migrations/live/` in this repo, so this one file covers
-- the identity ledger and the per-tenant business ledger alike.
--
-- The forbid_mutation trigger (0130_platform_projection.sql:58) stays exactly
-- as it was: ADD COLUMN is a schema change, not an UPDATE, and the trigger
-- fires on UPDATE/DELETE against DATA. The tamper-evidence chain (0499) is
-- similarly unaffected — its hash includes only actor_user_id, action,
-- module_key, entity_ref, before_json, after_json, so adding NULL-defaulted
-- columns does not perturb any historical hash.

ALTER TABLE immutable_ledger
  ADD COLUMN IF NOT EXISTS actor_name_snapshot  text,
  ADD COLUMN IF NOT EXISTS actor_email_snapshot citext,
  ADD COLUMN IF NOT EXISTS is_sensitive         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata             jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- One-shot back-fill for rows written before this migration. Joined on the
-- FK, so a row whose actor_user_id points at a user that no longer exists (or
-- lives in a different schema — the LIVE/SANDBOX identity landmine documented
-- on audit() in src/shared/events/emit.js) simply keeps a NULL snapshot,
-- which the humaniser reads as "You" for a self-scoped feed anyway.
UPDATE immutable_ledger l
   SET actor_name_snapshot  = u.full_name,
       actor_email_snapshot = u.email
  FROM app_user u
 WHERE l.actor_user_id       = u.user_id
   AND l.actor_name_snapshot IS NULL;

-- Sensitive rows are a small subset by design (God Mode, break-glass, etc.),
-- so a partial index is the right shape: it is tiny, kept warm, and answers
-- "show me every sensitive action, newest first" without scanning the whole
-- ledger. WHERE is_sensitive = true keeps the ~99% ordinary rows out entirely.
CREATE INDEX IF NOT EXISTS ix_ledger_sensitive
  ON immutable_ledger (created_at DESC) WHERE is_sensitive = true;

-- DOWN
-- Reversible. Dropping the columns loses the denormalised snapshots and the
-- sensitivity flag — historical rows revert to needing a join for the actor
-- name — but no data that isn't recoverable from the source tables.
-- ALTER TABLE immutable_ledger DROP COLUMN IF EXISTS metadata;
-- ALTER TABLE immutable_ledger DROP COLUMN IF EXISTS is_sensitive;
-- ALTER TABLE immutable_ledger DROP COLUMN IF EXISTS actor_email_snapshot;
-- ALTER TABLE immutable_ledger DROP COLUMN IF EXISTS actor_name_snapshot;
-- DROP INDEX IF EXISTS ix_ledger_sensitive;
