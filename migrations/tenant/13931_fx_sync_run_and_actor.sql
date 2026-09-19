-- ============================================================================
-- TENANT DB — 13931 FX sync-run log + manual-override actor (MOD-08, audit #6/#9).
--
-- TWO additive things the Currency audit asked for:
--
--   #9  WHO set a manual rate. `fx_rate_daily` records rate/date/source/fetched
--       but not the actor, so the Currency 360 override log could show "what and
--       when" and never "who" — even though setRate() already writes an audit
--       event with the actor. `set_by_user_id` denormalises that actor onto the
--       rate row so the override history renders it without a cross-table join.
--       PLAIN uuid column, no REFERENCES: the constraint-ordering rule (13791 /
--       tests/unit/migration-constraint-ordering) forbids adding an FK to a
--       PRE-EXISTING table above 13791. Referential intent is documented; the
--       app writes only real app_user ids (or NULL for a feed/rebase row).
--
--   #6  OPERATIONAL VISIBILITY of the nightly + manual sync. There was no record
--       of when sync last ran, whether it succeeded, what it updated, or whether
--       rates are stale — an administrator could not tell a disabled scheduler
--       from a silently-failing one. `fx_sync_run` is a NEW table, so it may
--       carry its own constraints/FK: one row per sync attempt (manual or cron),
--       with outcome, counts, and error, newest-first by started_at.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS. No existing data is rewritten.
-- ============================================================================

-- ── #9 · who set a manual override (plain column, documented FK intent) ──────
ALTER TABLE fx_rate_daily ADD COLUMN IF NOT EXISTS set_by_user_id uuid;
--   Intent: REFERENCES app_user(user_id). Enforced in the service, not by a
--   CHECK/FK here, per the 13791 rule for pre-existing tables.

-- ── #6 · sync-run log (new table — may constrain itself) ─────────────────────
CREATE TABLE IF NOT EXISTS fx_sync_run (
  fx_sync_run_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_code       char(3),                                   -- base at run time
  trigger         text NOT NULL DEFAULT 'manual'             -- 'manual' | 'cron'
                    CHECK (trigger IN ('manual','cron')),
  status          text NOT NULL DEFAULT 'ok'                 -- outcome of the run
                    CHECK (status IN ('ok','skipped','partial','error')),
  updated_count   integer NOT NULL DEFAULT 0,                -- quotes written
  unsupported     text[] NOT NULL DEFAULT '{}',              -- provider had no rate
  reason          text,                                      -- skip reason / error text
  actor_user_id   uuid REFERENCES app_user(user_id),         -- null for cron
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ix_fx_sync_run_started ON fx_sync_run (started_at DESC);

-- DOWN
-- Additive; dropping loses only the sync-run history and the denormalised actor.
--   DROP TABLE IF EXISTS fx_sync_run;
--   ALTER TABLE fx_rate_daily DROP COLUMN IF EXISTS set_by_user_id;
