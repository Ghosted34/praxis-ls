-- ============================================================================
-- 0462 — event orchestration (outbox consumption tracker)
-- The Universal Event Engine writes append-only `event_log` rows (a
-- forbid_mutation trigger blocks UPDATE/DELETE — they are immutable). To drive
-- write-time cross-module automation we need a MUTABLE per-event consumption
-- marker, so it lives in its own table rather than as a column on event_log.
--
-- The dispatcher (src/orchestration/dispatcher.js) processes event_log rows that
-- have NO event_dispatch row (never attempted) or a FAILED row under the retry
-- cap; DONE = handled, DEAD = exhausted retries (dead-letter). Idempotency is the
-- handler's responsibility (at-least-once delivery). See
-- doc/SYSTEM_CONNECTIVITY_AND_ORCHESTRATION.md (Plan A).
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_dispatch (
  event_id     bigint PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'DONE' CHECK (status IN ('DONE','FAILED','DEAD')),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of the work queue (retryable failures + dead-letter inspection).
CREATE INDEX IF NOT EXISTS ix_event_dispatch_status ON event_dispatch(status) WHERE status <> 'DONE';
