-- ============================================================================
-- TENANT DB — 13822 A subtask can carry its own deadline.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- `task_subtask` (13810) was a pure checklist: a title, a done flag, an order.
-- A step is now allowed its own `due_at`, so a task broken into milestones can
-- say WHEN each one is wanted — "documents to the bank by the 14th, payment
-- confirmed by the 20th" — rather than only whether the whole task is done.
--
-- ── WHY A BARE `due_at` AND NOT THE TASK'S REMINDER PAIR ────────────────────
--
-- `task` carries `reminder_minutes` / `remind_at` / `reminder_sent_at` because
-- a task is the thing a person is alerted about. A subtask is a step INSIDE
-- that task: the parent already reminds, and a second alert per step would be
-- noise, not safety. So a step gets a deadline it can be sorted and shown by —
-- on the calendar and the Today list, exactly like the parent's `due_at` — and
-- nothing more. If per-step reminders are ever wanted, the same armed-pair from
-- `task` drops in without reworking this column.
--
-- The value is the RESOLVED instant, set by the service on the tenant's
-- workplace clock (workspace.time.js), the same as `task.due_at` — a bare date
-- means end of the working day, not midnight.
--
-- Idempotent: additive only, guarded, safe to re-run.
-- ============================================================================

ALTER TABLE task_subtask ADD COLUMN IF NOT EXISTS due_at timestamptz;

COMMENT ON COLUMN task_subtask.due_at IS
  'Optional deadline for this one step, independent of the parent task''s due_at and surfaced on the calendar/Today the same way. No reminder pair: a step is a checklist item and the parent task carries the alert.';

-- "Subtask deadlines in this window" is a range scan on due_at; the partial
-- index holds only the steps that HAVE a deadline, which is the minority.
CREATE INDEX IF NOT EXISTS idx_task_subtask_due ON task_subtask (due_at) WHERE due_at IS NOT NULL;

-- ============================================================================
-- VERIFY
--   -- the column exists and takes an instant
--   INSERT INTO task_subtask (task_id, title, due_at)
--     VALUES ((SELECT task_id FROM task LIMIT 1), 'step', now());   -- ok
--   -- the range index backs a deadline sweep
--   EXPLAIN SELECT task_subtask_id FROM task_subtask
--     WHERE due_at >= now() AND due_at < now() + interval '1 month';
--     -- expects an Index/Bitmap scan on idx_task_subtask_due
--
-- DOWN
--   DROP INDEX IF EXISTS idx_task_subtask_due;
--   ALTER TABLE task_subtask DROP COLUMN IF EXISTS due_at;
--   -- Steps lose their per-step deadlines and become a plain checklist again;
--   -- the parent task's due_at is untouched.
-- ============================================================================
