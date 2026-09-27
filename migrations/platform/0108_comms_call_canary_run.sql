-- ============================================================================
-- PLATFORM DB — 0108 The daily call check (calls audit PR-7; owner decision O5)
-- ============================================================================
--
-- `comms-call-canary` runs once a day, platform-wide, at a daytime hour in
-- the corridor (COMMS_CALL_CANARY_CRON / _TZ, default 10:00 Africa/Douala),
-- and proves the pieces every tenant's calls share: the queue round trip, the
-- worker's live-signal emitter, the scheduler registrations, one English clip
-- through Groq and FORCED through Gemini, a Gemini summary and a FORCED
-- DeepSeek one, and a TURN allocation from the server. It also runs cheap
-- per-tenant checks that spend no provider credit (the tenant database
-- answers, no call stuck past its ring or cap deadline, no transcript stuck
-- in PROCESSING for over an hour).
--
-- One row per run. Read ONLY by the platform console (Health → Calls
-- pipeline); nothing of it is shown in a tenant app. A failure, and the
-- recovery after one, is a bell notification in the console and an
-- `alerts.raise` at severity `notify`.
--
-- A new table, so its constraints are declared inline.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.comms_call_canary_run (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
  -- [{ key, label, ok, ms, error }] — the platform-wide checks.
  checks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ slug, env, ok, problems[] }] — the per-tenant checks, failures first.
  tenant_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The plain-text summary the bell and the alert carry.
  summary       text
);

COMMENT ON TABLE platform.comms_call_canary_run IS
  'The daily platform call check (calls audit O5): shared pipeline pieces and cheap per-tenant checks. Console only.';

CREATE INDEX IF NOT EXISTS ix_comms_call_canary_started
  ON platform.comms_call_canary_run (started_at DESC);

-- ============================================================================
-- DOWN
--   DROP TABLE IF EXISTS platform.comms_call_canary_run;
-- ============================================================================
