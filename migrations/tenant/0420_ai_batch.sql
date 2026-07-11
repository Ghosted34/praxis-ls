-- ============================================================================
-- TENANT DB — 0420 AI action batches (AI_ARCHITECTURE §5).
-- A plan of 1..N AI-proposed writes shares a batch_id so the actions confirm,
-- execute and log together (halt on first failure). Single writes get their own
-- one-action batch. Reads never become action runs.
-- ============================================================================

ALTER TABLE ai_action_run ADD COLUMN IF NOT EXISTS batch_id uuid;
CREATE INDEX IF NOT EXISTS ix_ai_action_run_batch ON ai_action_run(batch_id);
