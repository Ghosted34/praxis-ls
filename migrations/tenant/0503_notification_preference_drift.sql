-- 0503 — Close the notification_preference drift.
--
-- DATA 3.3 (High). `notification_preference` is defined TWICE, with different
-- columns:
--
--   0440_settings_gaps.sql:13         CREATE TABLE IF NOT EXISTS … WITHOUT created_at
--   0472_notification_preference.sql  CREATE TABLE IF NOT EXISTS … WITH created_at
--
-- Both use IF NOT EXISTS and 0440 sorts first, so 0440 always wins. `created_at`
-- exists on NO database, on NO tenant, despite 0472 declaring it. 0472's
-- `CREATE INDEX IF NOT EXISTS` still ran, so the index IS present — the file
-- half-applied by design and reported success.
--
-- Nothing reads the column today (notification.repo selects `updated_at`), so
-- there is no live breakage. That is not what makes this High. What makes it
-- High is that the migration files stopped being a faithful description of the
-- schema, silently, and the tooling could not tell. Anyone reading 0472 —
-- reasonably — writes code against a column that does not exist, and finds out
-- at runtime on a customer's database.
--
-- THE FIX IS TO MAKE THE FILES TRUE AGAIN, not to pick a winner.
--
-- ADD COLUMN IF NOT EXISTS is the right instrument precisely because the two
-- files disagree about history: a tenant provisioned before 0472 has no
-- created_at, a hypothetical one that somehow ran 0472 first does. This
-- converges both onto the same shape without needing to know which happened.
--
-- The rows that already exist get `now()` as their created_at, which is a lie
-- about when they were created — so the column is documented as
-- "not before this migration" rather than pretending to be authoritative for
-- historical rows. A backfilled timestamp that looks precise and is not is
-- worse than one that admits its floor.

ALTER TABLE notification_preference
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN notification_preference.created_at IS
  'When the preference row was created. Rows predating migration 0503 carry that migration''s run time, not their true creation time (DATA 3.3).';

-- 0472 also declared this index. It was created, because CREATE INDEX ran even
-- though CREATE TABLE was skipped — restated here so this file alone describes
-- the intended end state.
CREATE INDEX IF NOT EXISTS ix_notif_pref_user ON notification_preference (user_id);

-- DOWN
-- Reversible, though dropping it re-opens the drift rather than undoing it.
--
-- ALTER TABLE notification_preference DROP COLUMN IF EXISTS created_at;
