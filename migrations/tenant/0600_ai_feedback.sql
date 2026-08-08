-- ============================================================================
-- TENANT DB — AI feedback: user ratings on assistant answers (thumbs up/down).
-- Powers the self-improvement loop: bad answers are flagged for prompt tuning,
-- good answers reinforce what works. Anonymous aggregation — no per-user
-- shaming, just signal.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_answer_feedback (
  feedback_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid REFERENCES ai_conversation(conversation_id) ON DELETE SET NULL,
  message_id       uuid REFERENCES ai_message(ai_message_id) ON DELETE SET NULL,
  user_id          uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  -- The question that produced this answer.
  question_text    text,
  -- The answer that was rated.
  answer_text      text,
  -- 'up' or 'down'.
  vote             citext NOT NULL CHECK (vote IN ('up', 'down')),
  -- Optional free-text comment (e.g. "wrong account number", "missed the débours").
  comment          text,
  -- Which actions were proposed/executed in this turn (for correlating bad
  -- feedback with specific action patterns).
  action_keys      citext[],
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_aifeedback_vote ON ai_answer_feedback(vote, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_aifeedback_convo ON ai_answer_feedback(conversation_id);
