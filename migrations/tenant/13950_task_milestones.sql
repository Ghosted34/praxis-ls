-- ============================================================================
-- TENANT DB — 13950 A task can sit on SEVERAL stages of its file's chain.
--
-- ── WHAT THIS CLOSES ───────────────────────────────────────────────────────
--
-- 13920 let a task name the operations file it is work on and, optionally, ONE
-- stage of that file's chain. One was the wrong number. "Chase the shipping
-- documents and lodge the declaration" is a single piece of work that plainly
-- belongs to two stages, and the dialog's single select forced the person
-- writing it to pick which half of their own task to file it under. The other
-- half then went missing from that stage's view on the file, and from the
-- Analytics rollup, while plainly being work on it.
--
-- So the stage becomes a SET: `task_milestone` holds one row per (task, stage).
--
-- ── WHY A JOIN TABLE AND NOT `uuid[]` ON `task` ────────────────────────────
--
-- An array column would have been one ALTER. It is not chosen because both
-- reads this exists for are the OTHER way round — "which tasks are on this
-- stage" (the stage's own view, the list filter, the rollup) — and an array
-- answers that with a GIN index and `= ANY` on every read that used to be an
-- equality, or with a sequential scan. A join table answers it with a btree
-- and a plain join, keeps a real foreign key to the stage (see below), and is
-- the shape `task_watcher` and `task_dependency` already gave this module for
-- exactly this kind of many-to-many.
--
-- ── `task.milestone_instance_id` STAYS, AS A PROJECTION ────────────────────
--
-- The 13920 column is not dropped and not renamed. It now carries the FIRST
-- stage of the set — the earliest in the chain — and is written by
-- `tasks.service.resolveFileLink` whenever the set changes, exactly as
-- `task.reminder_minutes` is a projection of `workspace_reminder` (13890).
-- Keeping it means every reader that has not learned about the set (the AI
-- adapter's older callers, an older client) still sees a stage where it saw
-- one before, and `idx_task_milestone` still serves them. The set is the
-- truth; the column is the summary.
--
-- ── WHY THIS TABLE MAY CARRY FOREIGN KEYS WHEN 13920'S COLUMNS COULD NOT ──
--
-- 13920's header explains the hazard: a constraint added above 13791 to a
-- table that ALREADY EXISTS aborts provisioning a new tenant, because 13791's
-- sandbox repair reads live's catalogue while sandbox is still behind it. It
-- guards that the TABLE exists in the target — so a table this same file
-- creates is invisible to it, and may carry any constraint it likes
-- (`tests/unit/migration-constraint-ordering.test.js` is the rule). `task` is
-- therefore not touched here at all; the new table takes the constraints.
--
-- ON DELETE CASCADE on both sides, and deliberately asymmetric with 13920's
-- dangling column: a link is a statement about two records, and when either
-- one goes the statement is void. A regenerated chain drops its old stages
-- and the links on them go too, rather than surviving as ids that point at
-- nothing and render as a blank chip.
--
-- ── WHAT THIS DOES NOT CHANGE ──────────────────────────────────────────────
--
-- A link never moves a milestone. Ticking off every task on a stage leaves
-- the chain where it was, because a milestone is what the company promised a
-- client and a personal to-do must not be able to advance it. Several links
-- are several statements of context, not several levers.
-- ============================================================================

-- ── 1. The set ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_milestone (
  task_id                uuid        NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  milestone_instance_id  uuid        NOT NULL REFERENCES milestone_instance(milestone_instance_id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- The pair IS the statement; saying it twice is not expressible.
  PRIMARY KEY (task_id, milestone_instance_id)
);

COMMENT ON TABLE task_milestone IS
  'The stages of an operations file''s chain a task belongs to — one row per '
  '(task, stage). Every stage must be a stage of task.dossier_id; '
  'tasks.service.resolveFileLink enforces that (it reads a second table, so '
  'it was never a CHECK''s to hold) and rewrites task.milestone_instance_id '
  'to the earliest stage of the set. A link only: completing tasks never '
  'advances a milestone.';

-- ── 2. The read this exists for ────────────────────────────────────────────
--
-- "What work is on this stage" — the stage's view on the file, the list's
-- milestone filter, the Analytics rollup. The primary key already serves the
-- other direction ("which stages is this task on").
CREATE INDEX IF NOT EXISTS idx_task_milestone_stage
  ON task_milestone (milestone_instance_id);

-- ── 3. Carry 13920's single stage into the set ─────────────────────────────
--
-- Joined to `milestone_instance` rather than copied blind: the 13920 column
-- has no foreign key, so a stage that has since been regenerated may be an id
-- pointing at nothing, and copying it would violate the key above and abort
-- this file. Such a row was already rendering as no stage; it stays that way.
INSERT INTO task_milestone (task_id, milestone_instance_id)
SELECT t.task_id, t.milestone_instance_id
  FROM task t
  JOIN milestone_instance mi ON mi.milestone_instance_id = t.milestone_instance_id
 WHERE t.milestone_instance_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFY
--   -- every 13920 stage that still exists is in the set
--   SELECT count(*) FROM task t
--     JOIN milestone_instance mi ON mi.milestone_instance_id = t.milestone_instance_id
--    WHERE NOT EXISTS (SELECT 1 FROM task_milestone tm
--                       WHERE tm.task_id = t.task_id
--                         AND tm.milestone_instance_id = t.milestone_instance_id);
--     -- expects 0
--   -- the stage's view is indexed
--   EXPLAIN SELECT t.task_id FROM task t
--     JOIN task_milestone tm ON tm.task_id = t.task_id
--    WHERE tm.milestone_instance_id = gen_random_uuid();
--     -- expects an Index Scan on idx_task_milestone_stage
--   -- the table exists on BOTH schemas, with its keys
--   SELECT table_schema FROM information_schema.tables
--    WHERE table_name = 'task_milestone' ORDER BY 1;          -- live, sandbox
--
-- DOWN
--   DROP TABLE IF EXISTS task_milestone;
--   -- Tasks keep their FIRST stage: task.milestone_instance_id was maintained
--   -- as the projection of the set the whole time, so 13920's readers lose
--   -- nothing they had. Only the second and later stages of a task are lost.
-- ============================================================================
