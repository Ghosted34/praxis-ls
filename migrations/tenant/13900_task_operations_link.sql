-- ============================================================================
-- TENANT DB — 13900 A task can name the operations file it is work on.
--
-- ── WHAT THIS CLOSES ───────────────────────────────────────────────────────
--
-- Workspace tasks are the only place in the product where a person writes down
-- what they personally have to do. Operations files are the only place where
-- the company records what it promised a client. Until now the two could not
-- be joined: "chase the BL" sat on somebody's list with no way to say WHICH
-- shipment, and the file's 360 could not show the human work happening around
-- it. So a manager asking "what is outstanding on the Brasseries export" had to
-- read a to-do list and a dossier side by side and match them by memory.
--
--   dossier_id             the file this task is work on
--   milestone_instance_id  the stage of that file's chain, when it is narrower
--                          than the file as a whole
--
-- Both nullable, and expected to stay NULL on most rows. A personal reminder
-- to renew a licence is not about a shipment, and forcing every task to name
-- one would make the field noise that people fill in wrongly.
--
-- ── WHY TWO COLUMNS AND NOT `entity_type`/`entity_id` ──────────────────────
--
-- 13810 gave `task` a type-plus-id pair precisely so a task could point at any
-- record without a column per kind, and re-using it for the file was the first
-- thing considered. Two reasons it is the wrong home here.
--
-- It holds ONE reference. A task raised from a costing already spends the pair
-- on `costing`, and stamping the file over it would silently destroy the link
-- that made the task clickable. The file is not an alternative to what a task
-- is about — it is the CONTEXT the work happens in, and a task can legitimately
-- have both ("approve this costing", on file SL-…).
--
-- And the milestone needs a second dimension regardless: a stage is not a
-- different kind of link to the file, it is a narrowing of it. One pair cannot
-- express "this file, that stage" at all.
--
-- The two columns are also what makes the Analytics rollup honest. Grouping
-- open work by file is `GROUP BY t.dossier_id` against a real indexed column;
-- against the polymorphic pair it would be a `WHERE entity_type = 'dossier'`
-- over a column with no index for it and no guarantee the id is a dossier.
--
-- ── WHY THERE IS NO FOREIGN KEY AND NO CHECK, THOUGH BOTH WOULD FIT ───────
--
-- `dossier` and `milestone_instance` live in THIS schema, beside `task`, so on
-- the merits both constraints belong here — and the first draft of this file
-- carried them. They are absent because of WHEN this migration runs, not
-- because of what it means.
--
-- `provisioning.service.js` migrates every file against `live`, then every
-- file against `sandbox`. 13791 repairs sandbox by mirroring the constraints
-- it finds in live, and during the SANDBOX pass it sees live at the head of
-- the list while sandbox is only at 13791. It guards that the table exists in
-- the target; it does not guard that the COLUMN does, and its handler does not
-- catch undefined_column. So a constraint added above 13791 to a table that
-- already existed aborts provisioning a NEW tenant — a red `migrations` job
-- that needs a live Postgres and that no gate in `npm run ci` can see. 13794
-- paid for that discovery; `tests/unit/migration-constraint-ordering.test.js`
-- is why nobody pays again, and it is the rule this file follows: an existing
-- table may gain PLAIN columns and nothing else.
--
-- WHERE THE TWO INVARIANTS LIVE INSTEAD, since they still hold:
--
--   · "a stage belongs to the file it is filed under" was never a CHECK's to
--     enforce anyway — it reads a second table. `tasks.service.resolveFileLink`
--     does it, and returns a 400 naming both records rather than a 23514 the
--     user cannot act on.
--   · "a stage implies a file" is the same function, one branch up. It also
--     CLEARS the stage whenever the file is cleared, so the pair cannot reach
--     the state the CHECK would have refused.
--   · The missing FK means a deleted file can leave an id pointing at nothing.
--     That is the same trade `entity_type`/`entity_id` made two migrations
--     earlier, and it degrades the same way: every read joins through
--     `dossier_visible`, so a dangling link renders as "A file you cannot
--     view" rather than as a broken screen. Both are covered by
--     `tests/unit/workspace-task-file-link.test.js`.
-- ============================================================================

-- ── 1. The columns ─────────────────────────────────────────────────────────
ALTER TABLE task ADD COLUMN IF NOT EXISTS dossier_id uuid;
ALTER TABLE task ADD COLUMN IF NOT EXISTS milestone_instance_id uuid;

COMMENT ON COLUMN task.dossier_id IS
  'The operations file this task is work on (dossier.dossier_id). NULL is the '
  'ordinary case — most tasks are not about a shipment. Distinct from '
  'entity_type/entity_id, which says what record the task POINTS AT; this says '
  'what file the work is IN. No FK by design: a constraint added above 13791 '
  'to a pre-existing table aborts provisioning — see the migration header.';
COMMENT ON COLUMN task.milestone_instance_id IS
  'The stage of the linked file''s chain this task belongs to '
  '(milestone_instance.milestone_instance_id). Requires dossier_id, and must '
  'be a stage of THAT file — both enforced by tasks.service.resolveFileLink, '
  'which also clears this whenever the file is cleared. A link only: '
  'completing tasks never advances a milestone, because a personal to-do must '
  'not move a client-facing promise.';

-- ── 2. The two reads this exists for ───────────────────────────────────────
--
-- "What work is open on this file" (the 360's Tasks tab, and the Analytics
-- rollup's GROUP BY). PARTIAL on `dossier_id IS NOT NULL`, because most rows
-- have none and indexing their NULLs would double the index for nothing.
CREATE INDEX IF NOT EXISTS idx_task_dossier
  ON task (dossier_id) WHERE dossier_id IS NOT NULL AND is_deleted = false;

-- "What work is on this stage" — the same read one level down.
CREATE INDEX IF NOT EXISTS idx_task_milestone
  ON task (milestone_instance_id) WHERE milestone_instance_id IS NOT NULL AND is_deleted = false;

-- ============================================================================
-- VERIFY
--   -- the rollup read is indexed
--   EXPLAIN SELECT count(*) FROM task WHERE dossier_id = gen_random_uuid()
--     AND is_deleted = false;
--     -- expects an Index Scan on idx_task_dossier
--   -- the columns exist on BOTH schemas (the reason there is no constraint)
--   SELECT table_schema, column_name FROM information_schema.columns
--    WHERE table_name = 'task' AND column_name IN ('dossier_id','milestone_instance_id')
--    ORDER BY 1, 2;                                   -- 4 rows: live ×2, sandbox ×2
--   -- a link to a file nobody can see reads as one, not as a crash
--   SELECT t.task_id, dv.ref FROM task t
--     LEFT JOIN dossier_visible dv ON dv.dossier_id = t.dossier_id
--    WHERE t.dossier_id IS NOT NULL AND dv.dossier_id IS NULL;
--
-- DOWN
--   DROP INDEX IF EXISTS idx_task_milestone;
--   DROP INDEX IF EXISTS idx_task_dossier;
--   ALTER TABLE task DROP COLUMN IF EXISTS milestone_instance_id;
--   ALTER TABLE task DROP COLUMN IF EXISTS dossier_id;
--   -- Tasks lose which file they were about. Nothing else changes: the link is
--   -- read-only context, so no milestone, dossier or task state depends on it.
-- ============================================================================
