-- ============================================================================
-- TENANT — 14110 Test calls: the diagnostics run
-- (doc/SMART_COMMS_CALLS_AUDIT.md, PR-7; owner decision O5).
--
-- One row per run of Comms → Setup → Test calls. The run exercises the real
-- call code but writes its results HERE and nowhere else: a run leaves no
-- row in comms_call, comms_call_recording, comms_call_transcript, the call
-- metrics, the chats or the notifications (asserted by
-- tests/unit/call-diagnostics.test.js).
--
-- Rows live in the LIVE schema whatever environment the run tested (`env`
-- says which), so the cap — 3 runs per tenant per day, counted here and
-- enforced by the server under an advisory lock — is per tenant, not per
-- schema. Kept 90 days; the service deletes older rows when a run starts.
--
-- A new table, so its constraints are declared inline
-- (tests/unit/migration-constraint-ordering.test.js concerns ALTERs).
-- ============================================================================

CREATE TABLE IF NOT EXISTS comms_call_diagnostic_run (
  run_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  env          text NOT NULL CHECK (env IN ('live', 'sandbox')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'RUNNING'
                 CHECK (status IN ('RUNNING', 'PASSED', 'WARN', 'FAILED')),
  -- [{ key, n, title, status, ms, cause, fix, code, detail, at }], in order.
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The plain-text "Copy report": run id, versions, timings, errors. Never
  -- audio, never a secret.
  report       text,
  -- The step-3 round trip: the worker emits this to the runner's screen,
  -- which echoes it back.
  signal_nonce text,
  app_version  text,
  user_agent   text
);

COMMENT ON TABLE comms_call_diagnostic_run IS
  'Comms → Setup → Test calls (calls audit O5): one row per run, 3 per tenant per day, kept 90 days. Results only; a run writes nothing to the call tables.';

CREATE INDEX IF NOT EXISTS ix_comms_call_diag_started
  ON comms_call_diagnostic_run (started_at DESC);

-- ============================================================================
-- DOWN
--   DROP TABLE IF EXISTS comms_call_diagnostic_run;
-- ============================================================================
