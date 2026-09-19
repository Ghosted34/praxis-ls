-- ============================================================================
-- 13920 — pin / archive / soft-delete on ai_conversation (audit J1, J2).
--
-- WHY. `doc/PRAXIS_AI_AUDIT.md` J1: a conversation could not be deleted or
-- archived. The repo exposed `currentConversation` / `startNewConversation` /
-- `clearHistory` and nothing else, and `clear` deliberately did NOT delete —
-- it started a new thread and retained the old one, because `ai_action_run`
-- FKs `conversation_id` with no ON DELETE clause, so a DELETE either failed on
-- the FK or would have taken the audit trail of what the assistant was asked
-- to do with it. The practical result is the case the review raised by name:
-- somebody researches a sensitive matter in the copilot and has no way to
-- remove it. J2 is the smaller sibling — a thread that matters sinks into the
-- time buckets with no way to hold it at the top.
--
-- THREE TIMESTAMPS, NOT THREE BOOLEANS. Each of these is a thing that happened
-- at a moment, and every one of them is a question somebody eventually asks:
-- when was this archived, how long has it been pinned, when did the user ask
-- for this to go. A boolean answers none of those and costs the same. It also
-- makes the ordering free — `pinned_at DESC` is "most recently pinned first"
-- without a second column to break the tie.
--
-- SOFT-DELETE IS NOT THE WHOLE STORY. `deleted_at` is what the list filters on,
-- and it is deliberately NOT the end of it: a user who deletes a sensitive
-- thread means gone, not hidden behind a WHERE clause. `assistant.repo.purge`
-- is the hard half — it detaches the FK'd `ai_action_run` rows, drops the ones
-- that never executed, and DELETEs the conversation so `ai_message` cascades.
-- The soft flag is what makes that safe to offer: the list stops showing the
-- thread the instant the user asks, and the irreversible half runs behind its
-- own confirm.
--
-- WHY NO `ON DELETE SET NULL` ON ai_action_run INSTEAD. That would be the
-- tidier schema and it is not available here: altering a constraint on a
-- PRE-EXISTING table above 13791 breaks a fresh tenant's sandbox pass — see
-- `tests/unit/migration-constraint-ordering.test.js`. Plain columns only. The
-- detach is therefore an explicit UPDATE in the purge, which is also the only
-- shape that lets it treat an EXECUTED run differently from a proposed one.
--
-- `title` ALREADY EXISTS (0400) and has never been written to — the list
-- COALESCEs the first user message as a fallback. Rename (J3) is an UPDATE of
-- that column, so it needs nothing here.
--
-- Nullable and additive: a conversation with none of these behaves exactly as
-- it does today. Idempotent.
-- ============================================================================

ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
ALTER TABLE ai_conversation ADD COLUMN IF NOT EXISTS pinned_at   timestamptz;

-- The hot path: `currentConversation` runs on every ask and now has to skip
-- the threads the user has put away. Partial, because the rows it excludes are
-- exactly the ones no live lookup ever wants.
CREATE INDEX IF NOT EXISTS ix_aiconversation_user_live
  ON ai_conversation (user_id, created_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

-- DOWN
--   -- Reversible, and the data loss is worth naming before you run it: these
--   -- three columns ARE the pin, the archive and the delete. Dropping them
--   -- returns every soft-deleted and archived thread to the history rail —
--   -- including, by definition, the sensitive ones somebody deleted on
--   -- purpose. If that matters more than the rollback, purge first
--   -- (`DELETE /ai/conversations/:id?purge=true`) and then drop.
--   --
--   -- Nothing else has to come back: the reads that filter on these columns
--   -- are in `assistant.repo.js`, which the older deploy does not carry, and
--   -- the rows the purge removed are gone either way.
--   DROP INDEX IF EXISTS ix_aiconversation_user_live;
--   ALTER TABLE ai_conversation DROP COLUMN IF EXISTS pinned_at;
--   ALTER TABLE ai_conversation DROP COLUMN IF EXISTS archived_at;
--   ALTER TABLE ai_conversation DROP COLUMN IF EXISTS deleted_at;
