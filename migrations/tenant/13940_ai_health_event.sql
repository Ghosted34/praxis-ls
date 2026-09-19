-- ============================================================================
-- 13940 — first-class AI health events (audit H2).
--
-- WHY THE USAGE LEDGER IS NOT THE RIGHT HOME. `ai_usage_ledger` (0400) answers
-- "what did this cost": tokens, XAF, vendor, model, tied to a budget period and
-- read by the spend cap. It has `was_successful` and `error_code`, and the
-- orchestrator passes `wasSuccessful: true` unconditionally — because by the
-- time it writes a row, a turn that degraded to the fallback or came back
-- truncated HAS succeeded, in the only sense the ledger means. Overloading it
-- would make a cost table answer a quality question, and the spend cap reads
-- that table.
--
-- WHAT THIS IS FOR. The audit's H2: "truncation, tool-selection misses,
-- duplicate-read grooves, and fallback-to-stub events are not first-class
-- metrics." Each of those is already DETECTED in the code and then thrown away
-- — `duplicates`, `nudged`, the fallback hop in `llm.chat`, the tool-round cap.
-- They are visible in a log line and nowhere a person can count them.
--
-- The sharpest case is truncation, and it is the reason this is worth a table.
-- PR 2 (B1) set an explicit `max_tokens` because answers were being cut off at
-- the vendor default. Nothing since then can tell whether the new ceiling is
-- ALSO being hit — `finish_reason` was never read. So the fix for B1 is
-- unverifiable in production, which is the same shape of problem B1 itself was.
--
-- SHAPE. Deliberately mirrors `ai_usage_ledger`: `conversation_id` is a plain
-- uuid with NO foreign key, exactly as the ledger has it. That is not an
-- oversight in either place — a conversation can now be purged (13920, audit
-- J1), and an FK here with no `ON DELETE` would block the purge and re-create
-- the problem J1 exists to fix. A health event is a diagnostic breadcrumb, not
-- a relation.
--
-- `kind` is TEXT with no CHECK. The set is owned by
-- `services/ai/health.service.js` (KINDS), which is where a new signal is
-- added, and a CHECK here would mean a migration every time the orchestrator
-- learns to notice something — on a pre-existing-table rule that forbids
-- exactly that above 13791. The service validates; the column stores.
--
-- Append-only, like the ledger: these are observations, and an observation that
-- can be edited is not one.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_health_event (
  health_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid REFERENCES app_user(user_id),
  conversation_id uuid,
  feature_key     citext,
  -- 'truncation' | 'fallback' | 'provider_exhausted' | 'vendor_config_error'
  -- | 'timeout' | 'tool_round_cap' | 'groove' | 'stall_nudge'
  kind            text NOT NULL,
  provider        text,
  model           text,
  -- Whatever makes the event actionable: the round it happened on, the vendor
  -- that was skipped, the action key that repeated. Read by the panel, never
  -- joined on.
  detail          jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- The panel's only query shape: a kind's rate over a window.
CREATE INDEX IF NOT EXISTS ix_aihealth_kind ON ai_health_event(kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_aihealth_occurred ON ai_health_event(occurred_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aihealth_ro') THEN
    CREATE TRIGGER trg_aihealth_ro BEFORE UPDATE OR DELETE ON ai_health_event
      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
  END IF;
END $$;

-- DOWN
--   -- Pure diagnostics: nothing reads these but the AI Control health panel,
--   -- and losing them costs history, not correctness. The orchestrator's
--   -- recorder is best-effort (`health.record` swallows its own failure), so an
--   -- older deploy that still calls it against a dropped table degrades to the
--   -- behaviour before this migration rather than failing a turn.
--   DROP TRIGGER IF EXISTS trg_aihealth_ro ON ai_health_event;
--   DROP TABLE IF EXISTS ai_health_event;
