-- ============================================================================
-- 0481 — rolling summary on ai_conversation.
--
-- WHY. Session 17 gave the assistant memory, but capped what is REPLAYED at the
-- last 20 messages (`orchestrator.service.js` HISTORY_TURNS) to keep per-call
-- token cost flat — AI spend is budget-capped per tenant, so an unbounded
-- transcript would make each successive question in a long thread cost more than
-- the last. Everything is still STORED; only the tail is re-sent.
--
-- The consequence, flagged at the time: turn 21 does not fade, it vanishes. Ask
-- the assistant something in message 3 and refer back to it in message 30 and it
-- has no idea what you mean — worse than having no memory, because the user has
-- been taught to expect it to remember.
--
-- SHAPE. A running summary of everything that has fallen out of the replay
-- window, kept ON the conversation rather than as another `ai_message` row:
--   - `summary` is REPLACED each time it is regenerated, not appended, so it
--     cannot itself grow without bound (that would recreate the problem it
--     solves);
--   - `summary_through` is the newest message the summary covers, so the next
--     regeneration knows exactly where to resume and a crash mid-way cannot
--     double-count or skip turns;
--   - `summary_at` is for diagnosing a stale or expensive summary.
--
-- Nullable and additive: a conversation with no summary behaves exactly as it
-- does today. Idempotent.
-- ============================================================================

ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS summary         text;
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS summary_through uuid REFERENCES ai_message(ai_message_id) ON DELETE SET NULL;
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS summary_at      timestamptz;
