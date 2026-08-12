-- ============================================================================
-- PLATFORM DB — 0097 Maintenance notice period (INFRASTRUCTURE_PLAN §3.5)
-- ============================================================================
--
-- 0095 created `maintenance_window` and the console can schedule one, but a
-- window was only ever visible to tenants for its own duration. That makes
-- "announced maintenance" a contradiction: the announcement arrives at the same
-- moment as the disruption, and for a READ_ONLY window that means writes stop
-- with no warning at all.
--
-- `notice_hours` is how long BEFORE `starts_at` tenant users see the banner.
--
-- WHY PER WINDOW AND NOT ONE DEPLOYMENT-WIDE SETTING
--
--   The right notice depends entirely on what the window is. An emergency
--   security patch at 02:00 wants an hour; a migration that parks writes for a
--   working day wants a week. A single global value would be tuned for one of
--   those and wrong for the other, and the person who knows which case this is
--   is the person scheduling it.
--
-- DEFAULT 24
--
--   A day's notice for anything scheduled, which is the common case and the
--   least surprising. 0 is explicitly allowed and means "no advance notice,
--   banner appears when the window opens" — the honest option for an emergency,
--   and better than pretending a notice period existed.
--
-- DOWN
-- Additive: one nullable-with-default column on one table.
-- ALTER TABLE platform.maintenance_window DROP COLUMN IF EXISTS notice_hours;

ALTER TABLE platform.maintenance_window
  ADD COLUMN IF NOT EXISTS notice_hours integer NOT NULL DEFAULT 24;

-- A negative notice would mean the banner appears after the window starts,
-- which is not a thing anyone means. Capped at 30 days because a banner shown
-- for longer than a month is wallpaper — people stop reading it, which is the
-- failure this whole feature is trying to avoid.
--
-- DO-block rather than DROP-then-ADD: a migration re-runs more often than
-- expected (a file that fails part way leaves its ledger row unwritten and the
-- WHOLE file runs again), and a bare ADD CONSTRAINT fails 42710 on the second
-- pass. See doc/BUILD_CONVENTIONS.md § Migrations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_notice_hours'
  ) THEN
    ALTER TABLE platform.maintenance_window
      ADD CONSTRAINT chk_notice_hours CHECK (notice_hours >= 0 AND notice_hours <= 720);
  END IF;
END
$$;

-- NO INDEX ON THE NOTICE-ADJUSTED START, DELIBERATELY.
--
-- The obvious index would be on `starts_at - notice_hours * interval`, and
-- Postgres refuses it: casting text to interval is not IMMUTABLE, so the
-- expression cannot be indexed. `make_interval(hours => notice_hours)` would
-- satisfy that rule — but the index still should not exist.
--
-- Nothing queries that expression. `maintenance.service.loadWindows()` selects
-- every window that is uncancelled and not yet finished — a handful of rows at
-- any time, since a window is a rare, scheduled event — and the notice-period
-- comparison happens in memory over that small set. The existing
-- `ix_maintenance_active` on (starts_at, ends_at) already serves the query that
-- is actually run.
--
-- An index nothing uses is not free: it is written on every insert and update,
-- and it misleads the next person into believing some query depends on it.

-- DOWN
-- ALTER TABLE platform.maintenance_window DROP CONSTRAINT IF EXISTS chk_notice_hours;
-- ALTER TABLE platform.maintenance_window DROP COLUMN IF EXISTS notice_hours;
