-- ============================================================================
-- TENANT DB — 13870 My Workspace: task dependencies, and the vocabulary the
-- hierarchy/collaboration surfaces emit.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
--   task_dependency   "this task is blocked by that one"
--   event_type rows   for the dependency, ping and watcher actions PR 2 adds
--
-- 13810 gave `task` a `parent_task_id`, which answers "what is this work part
-- of". It answers nothing about ORDER: a customs declaration that cannot be
-- lodged until the bill of lading is released is not the child of the BL, it
-- is SEQUENCED after it, and the two tasks may live under different parents or
-- under none. Order is an edge between two rows, so it is a table.
--
-- ── WHY A DIRECTED `blocked-by` EDGE AND NOT A `blocks` ONE ────────────────
--
-- The two are the same graph read from opposite ends, so only one can be
-- stored or they drift. `blocked-by` is the direction a PERSON asks in — "why
-- can I not start this?" is a question about the row in front of them — so the
-- row is owned by the blocked task and `depends_on_task_id` is the thing it
-- waits for. The reverse ("what am I holding up?") is one index away and is
-- served by `idx_task_dependency_depends_on` below.
--
-- ── WHY THE UNIQUE KEY IS THE PAIR, AND THE CHECK IS SELF-REFERENCE ────────
--
-- A duplicate edge is not a second dependency, it is the same statement twice,
-- and deduplicating in application code means every writer has to remember to.
-- The unique index makes it unrepresentable. Self-reference is likewise a
-- CHECK rather than a service rule: `a blocked by a` is never satisfiable and
-- would make the task permanently blocked with no way to see why.
--
-- ── WHY CYCLES ARE **NOT** A CONSTRAINT ────────────────────────────────────
--
-- This is the one rule the database deliberately does not hold, and saying so
-- here is better than a reader assuming it does. PostgreSQL can express
-- "not itself" (a CHECK, above) and "not twice" (a unique index, above), but a
-- longer cycle — a → b → c → a — is a property of the whole graph, and the only
-- declarative ways to hold it are a trigger running a recursive query on every
-- insert or a materialised closure table. Both cost every write to prevent a
-- mistake the service can refuse in one query.
--
-- So the reachability check lives in `tasks.repo.dependencyWouldCycle()`, which
-- walks `depends_on_task_id` from the proposed prerequisite with a recursive
-- CTE and refuses the edge if it can reach the blocked task. The service calls
-- it before every insert, inside the request transaction, so a concurrent pair
-- of inserts cannot both pass — and `tests/unit/workspace-dependencies.test.js`
-- pins the SQL. A cycle that somehow arrived would degrade to two tasks that
-- each report themselves blocked, not to a non-terminating read: every walk in
-- the service is depth-bounded.
--
-- ── WHY CANCELLED DOES NOT SATISFY AN EDGE ON ITS OWN ──────────────────────
--
-- A prerequisite that was cancelled was not DONE, and treating "abandoned" as
-- "finished" silently unblocks work whose precondition never happened. The
-- decision recorded in the guide is an EXPLICIT override, so the override is
-- stored on the edge (`overridden_at` / `overridden_by` / `override_reason`)
-- rather than inferred from the prerequisite's status. An override is a
-- person's statement that the blocked work may proceed anyway, and it is
-- attributable for the same reason an approval is.
--
-- ── NO SOFT DELETE ─────────────────────────────────────────────────────────
--
-- An edge is a statement about order, not a record of work. Removing one is
-- "these are no longer sequenced", there is nothing left to render, and the
-- audit row written by the service is the history. `ON DELETE CASCADE` on both
-- sides so deleting either task takes its edges with it — a dangling edge would
-- report a task blocked by something that no longer exists.
--
-- Idempotent throughout: guarded DDL and ON CONFLICT DO NOTHING, so live and
-- sandbox tenant upgrades can safely re-run it.
-- ============================================================================

-- ── 1. THE EDGE ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_dependency (
  task_dependency_id  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The task that waits. It owns the row — see the header.
  task_id             uuid        NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  -- The task it waits for.
  depends_on_task_id  uuid        NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,

  -- A task cannot wait for itself. The database holds this one because it is
  -- expressible; longer cycles are the service's, for the reason in the header.
  CONSTRAINT task_dependency_not_self CHECK (task_id <> depends_on_task_id),

  -- "Proceed anyway." Set together by the service; the reason is optional
  -- because forcing prose produces "n/a", not an explanation.
  overridden_at       timestamptz,
  overridden_by       uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,
  override_reason     text        CHECK (override_reason IS NULL OR char_length(override_reason) <= 500),
  CONSTRAINT task_dependency_override_pair
    CHECK ((overridden_at IS NULL AND overridden_by IS NULL)
        OR (overridden_at IS NOT NULL)),

  created_by          uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- The pair IS the statement, so a duplicate is not expressible rather than
-- being prevented by application code that every writer has to remember.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_dependency_pair
  ON task_dependency (task_id, depends_on_task_id);

-- "What is this task waiting for?" — the blocked-by read, one per task panel.
CREATE INDEX IF NOT EXISTS idx_task_dependency_task
  ON task_dependency (task_id);

-- "What is this task holding up?" — the reverse read, and the one the cycle
-- walk uses on every insert.
CREATE INDEX IF NOT EXISTS idx_task_dependency_depends_on
  ON task_dependency (depends_on_task_id);

COMMENT ON TABLE task_dependency IS
  'Directed blocked-by edges between workspace tasks. task_id waits for depends_on_task_id. Cycles are refused by tasks.repo.dependencyWouldCycle() in the service, not by a constraint — see the migration header.';
COMMENT ON COLUMN task_dependency.overridden_at IS
  'When somebody declared the blocked task may proceed despite this unresolved prerequisite. A CANCELLED prerequisite never satisfies an edge on its own.';

-- ── 2. EVENT VOCABULARY ────────────────────────────────────────────────────
--
-- `emitEvent` resolves its key against this catalogue, so a key with no row is
-- a failed write rather than a silent one. None of these is security-critical
-- (a dependency is not a permission) and none drives a workflow.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('task.dependency_added',      'MOD-00A', 'Workspace task dependency added',      false, false),
 ('task.dependency_removed',    'MOD-00A', 'Workspace task dependency removed',    false, false),
 ('task.dependency_overridden', 'MOD-00A', 'Workspace task dependency overridden', false, false),
 ('task.watcher_added',         'MOD-00A', 'Workspace task watcher added',         false, false),
 ('task.watcher_removed',       'MOD-00A', 'Workspace task watcher removed',       false, false),
 ('task.pinged',                'MOD-00A', 'Workspace task ping sent',             false, false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   -- the pair is unique and self-reference is refused
--   INSERT INTO task_dependency (task_id, depends_on_task_id)
--     SELECT task_id, task_id FROM task LIMIT 1;          -- 23514
--   -- the reverse read is indexed
--   EXPLAIN SELECT task_id FROM task_dependency WHERE depends_on_task_id = gen_random_uuid();
--     -- expects an Index Scan on idx_task_dependency_depends_on
--   -- the new keys resolve for emitEvent
--   SELECT count(*) FROM event_type WHERE module_key = 'MOD-00A';  -- 16
--
-- DOWN
--   DELETE FROM event_type WHERE key IN (
--     'task.dependency_added','task.dependency_removed','task.dependency_overridden',
--     'task.watcher_added','task.watcher_removed','task.pinged');
--   DROP TABLE IF EXISTS task_dependency;
--   -- Tasks lose their ordering. Nothing else changes: parent/child, checklist
--   -- steps and watchers are untouched, and a task with no edges is never
--   -- blocked, so every task simply becomes startable again.
-- ============================================================================
