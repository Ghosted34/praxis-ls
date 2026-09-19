-- ============================================================================
-- TENANT DB — 13975 My Workspace: task blockages — "I am blocked, and here is
-- why", as a first-class record rather than an inference.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
--   task_blockage     an external hold on a task, with the note that explains it
--   event_type rows   for the raised/resolved keys the service emits
--
-- 13870 taught the workspace that a task can wait for ANOTHER TASK
-- (`task_dependency`), and every "blocked" surface since then — the card pill,
-- the task panel callout, the Monitor's Blocked-work panel — is derived from
-- those edges. But the commonest hold in a freight office is not another task:
-- it is customs' network being down, a client who has not sent a document, a
-- port terminal on strike. Nothing in the task graph represents "the world is
-- blocking this", so the only way to say it was to invent a dummy task and
-- hang an edge off it — which pollutes the board with work nobody will ever
-- do, and reads wrongly in every rollup.
--
-- A blockage is therefore its own row: a note (the explanation), who raised
-- it and when, an optional estimate of when it will clear, and — once it
-- clears — who resolved it, when, and with what note.
--
-- ── WHY ONE ACTIVE BLOCKAGE PER TASK (PARTIAL UNIQUE INDEX) ────────────────
--
-- "This task is blocked" is a STATE; the notes are the history of how long it
-- was blocked and why. Two concurrent active blockages would make the card's
-- single snippet a lie by omission and the resolve button ambiguous about which
-- hold it clears. Resolving closes the active row and the next hold is a NEW
-- row, so the timeline of holds is exactly the set of resolved rows plus at
-- most one open one — which is what the panel's collapsible history renders.
--
-- ── WHY RESOLVED ROWS ARE KEPT AND NOT SOFT-DELETED ────────────────────────
--
-- A resolved blockage is the evidence behind two statements the product makes:
-- "this task was late because of X, for N days" (performance review) and "the
-- due date moved by N days when the hold cleared" (the shift the service
-- applies on resolve, recorded in `due_shift`). Deleting a hold would delete
-- the reason a date is what it is. There is no delete endpoint; a blockage
-- raised in error is resolved with a note saying so.
--
-- ── WHY `due_shift` IS RECORDED ON THE BLOCKAGE AND NOT COMPUTED ───────────
--
-- The service moves an open task's `due_at` forward by the blocked duration
-- when the hold clears. Storing the applied shift on the row that caused it
-- keeps "why is this deadline later than the one I wrote" answerable from the
-- task's own history forever, rather than from an audit row nobody reads and
-- a diff of two timestamps nobody can prove came from this hold.
--
-- ── NO CATEGORY ENUM, DELIBERATELY ─────────────────────────────────────────
--
-- The note is free text on purpose. A fixed list (customs / network / client /
-- port) would look reportable and be wrong by the second tenant: every office
-- has its own taxonomy of excuses, and a picker teaches people to pick the
-- least embarrassing option rather than describe the hold. Reporting on holds
-- is a future that can cluster notes then; losing the plain sentence now would
-- be unrecoverable.
--
-- Idempotent throughout: guarded DDL and ON CONFLICT DO NOTHING, so live and
-- sandbox tenant upgrades can safely re-run it.
-- ============================================================================

-- ── 1. THE BLOCKAGE ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_blockage (
  task_blockage_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The task that is held. CASCADE, like every other child of a task: a
  -- deleted task's holds are not history anybody can act on, and a dangling
  -- hold would report a blockage on something that no longer exists.
  task_id             uuid        NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,

  -- The explanation. Required and bounded: a blockage with no note is a red
  -- badge with nothing behind it, which is worse than no badge — it invites
  -- the reader to imagine a worse hold than the real one.
  note                text        NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),

  -- "We expect this to clear by…". Optional and advisory: nothing schedules
  -- off it, it is the raiser's estimate shown beside the note so a manager can
  -- see at a glance whether the hold outlives its own forecast.
  estimated_resolve_at timestamptz,

  raised_by           uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,
  raised_at           timestamptz NOT NULL DEFAULT now(),

  -- NULL while the hold is live. The pair constraint below keeps a resolve
  -- stamp from arriving without a resolver, the same shape 13870 used for
  -- dependency overrides: attributable acts carry an actor.
  resolved_at         timestamptz,
  resolved_by         uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,
  resolve_note        text        CHECK (resolve_note IS NULL OR char_length(resolve_note) <= 500),

  -- The due-date movement the service applied when this hold cleared (NULL
  -- when the task had no due date, or was already closed). See the header.
  due_shift           interval,

  CONSTRAINT task_blockage_resolve_pair
    CHECK ((resolved_at IS NULL AND resolved_by IS NULL)
        OR (resolved_at IS NOT NULL)),
  -- A hold cannot clear before it starts. Cheap to hold here, and it makes
  -- "blocked for -3 days" unrepresentable rather than merely unlikely.
  CONSTRAINT task_blockage_resolve_after_raise
    CHECK (resolved_at IS NULL OR resolved_at >= raised_at)
);

-- One live hold per task — see the header. Resolved rows are unlimited: they
-- ARE the history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_blockage_one_active
  ON task_blockage (task_id) WHERE resolved_at IS NULL;

-- The task panel's collapsible: "this task's holds, newest first", one index
-- scan per open panel.
CREATE INDEX IF NOT EXISTS idx_task_blockage_task
  ON task_blockage (task_id, raised_at DESC);

-- The Monitor's Blocked-work panel and every blocked count read "which open
-- tasks carry a live hold"; the partial index makes that a scan of holds, not
-- of tasks.
CREATE INDEX IF NOT EXISTS idx_task_blockage_active
  ON task_blockage (task_id) WHERE resolved_at IS NULL;

COMMENT ON TABLE task_blockage IS
  'External holds on a workspace task ("customs network down"), with the note that explains them. At most one active row per task; resolved rows are the history behind overdue explanations and due-date shifts.';
COMMENT ON COLUMN task_blockage.due_shift IS
  'The due-date movement the service applied to the task when this blockage was resolved. NULL when nothing moved (no due date, or the task was already closed).';
COMMENT ON COLUMN task_blockage.estimated_resolve_at IS
  'The raiser''s advisory estimate of when the hold clears. Nothing schedules off it.';

-- ── 2. EVENT VOCABULARY ────────────────────────────────────────────────────
--
-- `emitEvent` resolves its key against this catalogue, so a key with no row is
-- a failed write rather than a silent one. Neither key drives a workflow; both
-- exist so the audit ledger and any future workflow can hang off "a hold
-- started" / "a hold cleared".
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('task.blockage_raised',   'MOD-00A', 'Workspace task blockage raised',   false, false),
 ('task.blockage_resolved', 'MOD-00A', 'Workspace task blockage resolved', false, false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   -- a second active blockage on one task is unrepresentable
--   INSERT INTO task_blockage (task_id, note) SELECT task_id, 'first' FROM task LIMIT 1;
--   INSERT INTO task_blockage (task_id, note) SELECT task_id, 'second' FROM task LIMIT 1;
--     -- expects 23505 unique_violation on uq_task_blockage_one_active
--   -- resolving frees the slot
--   UPDATE task_blockage SET resolved_at = now(), resolved_by = raised_by
--    WHERE note = 'first';
--   INSERT INTO task_blockage (task_id, note) SELECT task_id, 'third' FROM task LIMIT 1;
--     -- expects one row
--   -- a resolve stamp without a resolver is refused
--   UPDATE task_blockage SET resolved_at = now() WHERE note = 'third';
--     -- expects 23514 on task_blockage_resolve_pair
--   -- the new keys resolve for emitEvent
--   SELECT count(*) FROM event_type WHERE key IN
--     ('task.blockage_raised','task.blockage_resolved');   -- 2
--
-- DOWN
--   DELETE FROM event_type WHERE key IN ('task.blockage_raised','task.blockage_resolved');
--   DROP TABLE IF EXISTS task_blockage;
--   -- Tasks lose their recorded holds and the due-date shifts already applied
--   -- stay applied (they are writes to task.due_at, not to this table). Every
--   -- task simply reports unblocked-by-hold again; dependency blocking (13870)
--   -- is untouched.
-- ============================================================================
