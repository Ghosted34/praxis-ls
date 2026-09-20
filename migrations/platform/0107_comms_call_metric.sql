-- ============================================================================
-- PLATFORM DB — 0107 Smart Comms call metrics (SMART_COMMS_CALLS_ENGINEERING_
-- GUIDE §7.2, PR-3).
-- ============================================================================
--
-- The calls programme shipped two PRs that write a great deal and can be read by
-- nobody: `comms_call` rows live in each TENANT database, behind each tenant's
-- own connection, and the platform's ops surface has no way to answer "how are
-- calls actually working". The three questions the programme's own acceptance
-- criteria ask (§7.4.4) are, in order: are calls connecting, are the transcripts
-- surviving, and how hard is web push actually working.
--
-- WHY A PLATFORM TABLE AND NOT A VIEW OVER THE TENANT SCHEMAS
--
--   There is no such thing as a view over twenty databases. Every reader would
--   open every tenant's pool to answer one question, which is the shape of
--   query that turned the fleet sweeps into an outage once already (see
--   services/platform/db.js and its ops pool). The aggregation job opens a
--   tenant's connection once a day, on its own clock; the console reads one
--   table in the platform database.
--
-- GRAIN: one row per (tenant, env, day) — NOT one row per call, and not a
-- rolled-up fleet total.
--
--   Per call is the wrong grain because the console asks for a trend, and a
--   trend over a table that grows with the business is a query that gets slower
--   every week for no added information. A pre-aggregated day is ~365 rows per
--   tenant per year: small enough that the read is free, and it is the grain the
--   30-day chart actually wants.
--
--   The fleet total is the wrong grain because a fleet-wide number hides the
--   thing worth finding — one tenant whose transcription fails every call looks
--   like a 5% blip across twenty. The tenant dimension is the point; the fleet
--   number is a sum the console can do in one line.
--
--   `env` is in the key because the sandbox is where training happens: mixing
--   a tenant's TEST-day calls into its production figures would make the
--   numbers describe neither. (The call sweep already runs in both schemas for
--   this reason.)
--
-- WHY THE COLUMNS ARE COUNTS AND NOT DERIVED RATES
--
--   A stored average or percentage is a number that cannot be re-derived when
--   the definition changes, and re-aggregating it (to roll a week up, say) is
--   wrong arithmetic. Counts add; averages need the denominator beside them,
--   which is why `avg_duration_seconds` is stored WITH `calls_answered` — the
--   pair is what makes a weighted mean possible without going back to the
--   tenant.
--
-- IDEMPOTENT BY PRIMARY KEY: the aggregation re-runs the last 7 days on every
-- tick, so a worker that was down for three days repairs itself on the next
-- run, and a job that runs twice writes the same row twice with the same
-- numbers rather than doubling them.
--
-- RETENTION: 400 days, purged by the same job's `purge` kind. The window is
-- deliberately longer than the 30-day chart: the point of a year of it is that
-- "was last August like this" is answerable, and 400 days at a fleet of twenty
-- tenants is ~8k rows.
--
-- ── THE ONE STATE COLUMN ───────────────────────────────────────────────────
--
--   `transcription_alert_at` is on the row rather than in a settings table
--   because it is a fact about THAT DAY's data, not about the deployment: the
--   sustained-failure alarm must be able to say "already raised for this window"
--   without a second table whose rows would have to be purged in step with
--   these. NULL means "the alarm has not been raised for this day".
--
-- DOWN
--   DROP TABLE IF EXISTS platform.comms_call_metric;
--   -- Losing it loses history, not data: every number here is re-derivable
--   -- from the tenant tables, and the next aggregation tick rebuilds the last
--   -- seven days of it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform.comms_call_metric (
  tenant_slug      text NOT NULL,
  env              text NOT NULL,
  metric_date      date NOT NULL,

  -- Outcome counts. Six of them for eight terminal statuses, deliberately:
  -- CANCELLED (the caller gave up), DECLINED and BUSY are the callee's answer
  -- to a ring that was heard, and lumping them into "not answered" would make
  -- the one number that matters — was the person reached — unanswerable.
  calls_started    integer NOT NULL DEFAULT 0,
  calls_answered   integer NOT NULL DEFAULT 0,
  calls_no_answer  integer NOT NULL DEFAULT 0,
  calls_declined   integer NOT NULL DEFAULT 0,
  calls_busy       integer NOT NULL DEFAULT 0,
  calls_failed     integer NOT NULL DEFAULT 0,

  -- Stored beside calls_answered so a weighted mean over any date range is
  -- possible. NULL, not 0, when nothing was answered: "no calls" and "calls of
  -- zero length" are different, and 0 would drag an average toward it.
  avg_duration_seconds integer,

  -- The never-dies guarantee's alarm (§4.5, §7.2). `reasons` is jsonb —
  -- a map of reason → count — because the reason is the actionable half: a
  -- provider timeout, an upload that never arrived and a worker that died
  -- looking identical as a count is how an alert becomes something people mute.
  transcription_failed          integer NOT NULL DEFAULT 0,
  transcription_failed_reasons  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- §7.4.4's ring-channel split: which channel the callee's device was ringing
  -- on when it acknowledged. `ring_none` is the honest fourth bucket — NO ack
  -- arrived on any channel, which is the case the whole escalation exists for
  -- (closed app, no push subscription, iOS refusing to wake the PWA). It is a
  -- superset of "rang nobody" and a subset of "was not answered": a call
  -- declined from a device that never acked lands here too, which is the right
  -- reading — no channel confirmed a landing. A distribution that counted only
  -- acknowledgements would make its own failures invisible.
  ring_socket       integer NOT NULL DEFAULT 0,
  ring_notification integer NOT NULL DEFAULT 0,
  ring_push         integer NOT NULL DEFAULT 0,
  ring_none         integer NOT NULL DEFAULT 0,

  -- When the sustained-failure alarm was raised for this row's window (NULL =
  -- not raised). Written by the evaluator, read by it to stop a condition that
  -- persists for a day from paging every hour.
  transcription_alert_at timestamptz,

  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_slug, env, metric_date)
);

-- Every read is "the last N days", fleet-wide or for one tenant.
CREATE INDEX IF NOT EXISTS ix_comms_call_metric_date
  ON platform.comms_call_metric (metric_date DESC);
CREATE INDEX IF NOT EXISTS ix_comms_call_metric_tenant
  ON platform.comms_call_metric (tenant_slug, env, metric_date DESC);

-- DOWN
-- DROP TABLE IF EXISTS platform.comms_call_metric;
