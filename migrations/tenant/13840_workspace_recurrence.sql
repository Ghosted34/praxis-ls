-- ============================================================================
-- TENANT DB — 13840 Recurring tasks and calendar events.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- "Every month on the 14th, remind the accountant to file taxes." Until now a
-- task and an event were both one-shot: a `due_at`/`start_at`, one reminder,
-- and then a row that sits in history forever. This adds the repeat.
--
--   task.recurrence_rule         the series definition (an iCal RRULE)
--   task.recurrence_series_id    which series this row belongs to
--   task.recurrence_cursor_at    the next occurrence this row has materialised
--   calendar_event.recurrence_series_id    (recurrence_rule already existed)
--   calendar_event.recurrence_cursor_at
--
-- ── THIS REVERSES A DECISION IN 13810, ON PURPOSE ──────────────────────────
--
-- 13810 stored `calendar_event.recurrence_rule` as an RRULE and said, in as
-- many words, that occurrences would be EXPANDED AT READ TIME and never turned
-- into rows: "a weekly meeting for two years is 104 rows that all have to move
-- when the series moves". Nothing ever implemented the expansion, so the column
-- was write-only — a rule the server stored and no query read.
--
-- Materialising occurrences instead is the right call for this product, and the
-- reason is the reminder sweep rather than the calendar grid. A reminder is a
-- pair of columns (`remind_at` armed / `reminder_sent_at` fired) and the sweep
-- is a scan over armed rows. An occurrence that exists only as a computed date
-- inside an RRULE has no columns to arm, so a read-time expansion would have
-- needed a SECOND reminder mechanism — a scheduler that computes "which virtual
-- occurrences are now within their lead time", per tenant, per minute, with its
-- own idempotency story. Materialising means the occurrence is a row, the row
-- arms the same way every other row does, and the sweep is unchanged.
--
-- Per-occurrence STATE settles it. "September's filing is done, October's is
-- not" is not expressible over a virtual occurrence without an exceptions table
-- — which is the row-per-occurrence cost 13810 was avoiding, plus a join. And
-- the 104-rows objection is bounded in practice: an occurrence is created only
-- when the previous one comes DUE (see the cursor), so a series holds as many
-- rows as it has actually reached, not as many as it could ever have.
--
-- ── SPAWN, DO NOT ROLL ─────────────────────────────────────────────────────
--
-- Each occurrence is its OWN row with its own `due_at`, its own status and its
-- own reminder, sharing a `recurrence_series_id`. A recurring tax filing is
-- audit evidence — that September's return was filed, and when — and rolling one
-- row forward destroys the history the module exists to keep. The rows are
-- linked by the series id rather than by `parent_task_id`, which already means
-- "a step's parent" and is not a series.
--
-- ── WHY THE CURSOR, AND WHY THE SWEEP IS THE ONLY THING THAT SPAWNS ────────
--
-- `recurrence_cursor_at` is "the next occurrence this row has already
-- materialised", and the spawn scan is one predicate:
--
--     WHERE recurrence_rule IS NOT NULL AND is_deleted = false
--       AND COALESCE(recurrence_cursor_at, due_at) <= now()
--
-- NULL means "nothing spawned yet, so the anchor is my own due date" — which is
-- why the COALESCE and not a second branch. A row whose cursor is in the future
-- is a row that has done its job and leaves the scan until that date arrives.
--
-- Spawning lives in the reminder sweep and NOWHERE ELSE, for the same reason
-- the reminder itself lives there: one code path, already single-flight, already
-- idempotent, already running every minute against every tenant environment.
-- Spawning on completion was the tempting alternative and is wrong twice — a
-- task finished early would put next month's row on the board beside this
-- month's, and a task never finished would stop the series dead. Advancing on
-- the DUE DATE means next month's task appears when this month's is due, which
-- is the sentence a person actually means.
--
-- ── WHY THE UNIQUE INDEX IS THE IDEMPOTENCY GUARD ──────────────────────────
--
-- Two rows of one series can be scanned in the same tick (the current one and
-- the previous one, whose cursor has just come due), and both compute the same
-- next occurrence. The partial UNIQUE index on (series, anchor date) plus
-- `INSERT … ON CONFLICT DO NOTHING` makes that a no-op rather than a duplicate,
-- and — like the reminder pair in 13810 — the guarantee is in the schema rather
-- than in the caller's discipline. The cursor is advanced even when the insert
-- conflicts, which is what stops a row that lost the race from matching the
-- scan every minute forever.
--
-- The index deliberately does NOT exclude soft-deleted rows. Deleting next
-- month's occurrence should mean it stays deleted, not that the sweep quietly
-- brings it back on the next tick.
--
-- ── AN EXHAUSTED SERIES CLEARS ITS OWN RULE ────────────────────────────────
--
-- When a rule reaches its `UNTIL` (or its `COUNT`), the sweep sets
-- `recurrence_rule = NULL` on the row it was working from. The row keeps its
-- `recurrence_series_id`, so the history stays linked; it simply stops
-- repeating, which is the truth, and it leaves the scan for good. The
-- alternative — a sentinel cursor of 'infinity' — would put a value no client
-- can render into a column every client selects.
--
-- ── NO NEW TABLE, AND WHY ──────────────────────────────────────────────────
--
-- A `recurrence_series` table was the obvious shape: the rule lives once, the
-- occurrences point at it. It is also three joins for a board that already
-- joins two user tables, and a series with no remaining occurrences is a row
-- nothing reads. Denormalising the rule onto each row costs one text column per
-- occurrence and makes every read a single scan — the same trade 13810 made
-- with `entity_type`/`entity_id`.
--
-- Idempotent: every statement is guarded, so this is safe to re-run.
-- ============================================================================

-- ── 1. TASK ────────────────────────────────────────────────────────────────

ALTER TABLE task ADD COLUMN IF NOT EXISTS recurrence_rule text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS recurrence_series_id uuid;
ALTER TABLE task ADD COLUMN IF NOT EXISTS recurrence_cursor_at timestamptz;

COMMENT ON COLUMN task.recurrence_rule IS
  'The series definition as an iCal RRULE (FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, BYMONTHDAY, BYDAY, UNTIL, COUNT). NULL is a one-off task. The sweep CLEARS this when the rule is exhausted, which is how a finished series leaves the spawn scan.';
COMMENT ON COLUMN task.recurrence_series_id IS
  'Shared by every occurrence of one series and equal to the FIRST occurrence''s task_id, so the series is addressable without a registry table. NULL for a task that does not repeat. Not parent_task_id, which already means "a step''s parent".';
COMMENT ON COLUMN task.recurrence_cursor_at IS
  'The next occurrence this row has already materialised. NULL until the first spawn, after which the anchor is this rather than due_at. Advanced even when the insert loses the unique-index race, so a row cannot re-match the spawn scan every minute.';

-- The spawn scan. Partial on purpose: the recurring rows are a small minority
-- of a tenant's tasks, and a non-recurring task is not in this index at all.
CREATE INDEX IF NOT EXISTS idx_task_recurrence_due
  ON task (COALESCE(recurrence_cursor_at, due_at))
  WHERE recurrence_rule IS NOT NULL AND is_deleted = false AND due_at IS NOT NULL;

-- One occurrence per date per series. This is the idempotency guard — see the
-- header — and it is what makes two rows of a series scanned in the same tick
-- produce one new row rather than two.
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_series_occurrence
  ON task (recurrence_series_id, due_at)
  WHERE recurrence_series_id IS NOT NULL AND due_at IS NOT NULL;

-- "Every task in this series", for the whole-series edit and for COUNT.
CREATE INDEX IF NOT EXISTS idx_task_series
  ON task (recurrence_series_id)
  WHERE recurrence_series_id IS NOT NULL;

-- ── 2. CALENDAR EVENT ──────────────────────────────────────────────────────

-- `recurrence_rule` is 13810's column and is not re-declared: a CREATE-style
-- redefinition of an existing column is exactly the drift check-schema-drift.js
-- exists to catch.

ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS recurrence_series_id uuid;
ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS recurrence_cursor_at timestamptz;

COMMENT ON COLUMN calendar_event.recurrence_rule IS
  'The series definition as an iCal RRULE. NULL is a one-off event. Written by 13810 and read by nobody until 13840: occurrences are now materialised by the reminder sweep rather than expanded at read time — see 13840''s header for why that decision was reversed.';
COMMENT ON COLUMN calendar_event.recurrence_series_id IS
  'Shared by every occurrence of one series and equal to the first occurrence''s calendar_event_id. NULL for an event that does not repeat.';
COMMENT ON COLUMN calendar_event.recurrence_cursor_at IS
  'The next occurrence this row has already materialised. NULL until the first spawn. Same mechanism as task.recurrence_cursor_at; see that column.';

CREATE INDEX IF NOT EXISTS idx_calendar_event_recurrence_due
  ON calendar_event (COALESCE(recurrence_cursor_at, start_at))
  WHERE recurrence_rule IS NOT NULL AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_event_series_occurrence
  ON calendar_event (recurrence_series_id, start_at)
  WHERE recurrence_series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_event_series
  ON calendar_event (recurrence_series_id)
  WHERE recurrence_series_id IS NOT NULL;

-- ============================================================================
-- VERIFY
--   -- a recurring task carries its rule and its series
--   INSERT INTO task (title, created_by, due_at, recurrence_rule)
--     VALUES ('File TVA', '00000000-0000-0000-0000-000000000001',
--             '2026-10-14 17:00+01', 'FREQ=MONTHLY;BYMONTHDAY=14');
--   -- one occurrence per date per series: the second insert is refused
--   WITH s AS (SELECT recurrence_series_id FROM task WHERE title = 'File TVA')
--   INSERT INTO task (title, created_by, due_at, recurrence_series_id)
--     SELECT 'File TVA', '00000000-0000-0000-0000-000000000001',
--            '2026-10-14 17:00+01', recurrence_series_id FROM s;      -- 23505
--   -- the spawn predicate is index-backed
--   EXPLAIN SELECT task_id FROM task
--     WHERE recurrence_rule IS NOT NULL AND is_deleted = false
--       AND COALESCE(recurrence_cursor_at, due_at) <= now();
--     -- expects a scan on idx_task_recurrence_due
--
-- DOWN
--   DROP INDEX IF EXISTS idx_calendar_event_series;
--   DROP INDEX IF EXISTS ux_calendar_event_series_occurrence;
--   DROP INDEX IF EXISTS idx_calendar_event_recurrence_due;
--   ALTER TABLE calendar_event DROP COLUMN IF EXISTS recurrence_cursor_at;
--   ALTER TABLE calendar_event DROP COLUMN IF EXISTS recurrence_series_id;
--   -- recurrence_rule itself is 13810's column and survives: dropping it here
--   -- would take a column another migration owns.
--   DROP INDEX IF EXISTS idx_task_series;
--   DROP INDEX IF EXISTS ux_task_series_occurrence;
--   DROP INDEX IF EXISTS idx_task_recurrence_due;
--   ALTER TABLE task DROP COLUMN IF EXISTS recurrence_cursor_at;
--   ALTER TABLE task DROP COLUMN IF EXISTS recurrence_series_id;
--   ALTER TABLE task DROP COLUMN IF EXISTS recurrence_rule;
--   -- Tasks and events become one-shot again. Spawned occurrences are ordinary
--   -- rows and stay; they simply stop being linked to a series.
-- ============================================================================
