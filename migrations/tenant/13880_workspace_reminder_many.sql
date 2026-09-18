-- TENANT DB — 13880 One record, several reminders.
--
-- ── THE LIMITATION THIS UPGRADE REMOVES ─────────────────────────────────────
--
-- 13810 gave both `task` and `calendar_event` three reminder columns —
-- `reminder_minutes` (the relative preset), `remind_at` (the resolved instant
-- the sweep reads) and `reminder_sent_at` (the "whether"). They solve "remind
-- me once before this deadline" and nothing more: a task wanted at the
-- week's planning meeting, the morning of, and an hour before can carry only
-- one of those, because `reminder_sent_at`'s NULL-means-armed discipline has
-- exactly one stamp per record. PR 2's dashboard surfaces made the same task
-- show up on Today and Calendar from three clocks; the reminder stayed
-- single-issued because the schema said so, not because the user did.
--
-- ── THE CHOICE OF TABLE ─────────────────────────────────────────────────────
--
-- One polymorphic `workspace_reminder` table, not a child table per entity.
-- The sweep is ONE query against one armed set (plus two owner joins to apply
-- per-owner rules); a per-entity table has to read both kinds, union them and
-- keep two sets of constraints in lock-step, which is the same drift the
-- TASK_SELECT/TASK_SELECT_PAGED split exists to guard. A polymorphic table's
-- integrity questions (no real FK, one row type) are answered here, not
-- glossed: owner_type is a CHECK, the parent's invariants are enforced
-- per-owner on insert/update by the service and guarded by the table's own
-- CHECKs, and the partial index keeps the sweep's armed set compact.
--
-- ── WHAT A ROW IS ───────────────────────────────────────────────────────────
--
-- A row is ONE reminder for ONE owner. The sweep's table predicate is
-- `remind_at <= now() AND reminder_sent_at IS NULL` — NULL means armed, just
-- like 13810 — but each ROW carries `workspace_reminder_id`, so "which one
-- fired" is the row, not "the record's one reminder". A relative row
-- (`reminder_minutes` set, `remind_at` null) re-materialises per occurrence
-- when the series spawns, over and over; an absolute row (`remind_at` set,
-- `reminder_minutes` null) fires at its instant and is DONE (its sent stamp
-- lands on the row itself, on purpose, and a later update that moves the
-- remind_at clears it — the re-arm discipline unchanged).
--
-- WHY remind_at CAN BE NULL: it needs to stay nullable so the sweep can read
-- a relative row and leave it computable per occurrence. The scheduled
-- semantics for both kinds stay on the row: only relative rows need a
-- spawn-time anchor, because a fixed instant does not move when the due date
-- does, and a relative one does.
--
-- ── EMAIL ───────────────────────────────────────────────────────────────────
--
-- `email: true` records the row's "this reminder wants email". The sweep reads
-- it and EMAILS ON THE OVERRIDE — this is a deliberate, recorded choice: a
-- ticking author has spoken for that specific deadline, and the recipient's
-- ordinary email preference is otherwise in charge. It overrides, but it
-- leaves a trace: the service stamps the choice at write, the audit trail
-- carries it, and the row carries `updated_by` so "who asked" is answerable.
--
-- ── CARRY-OVER ──────────────────────────────────────────────────────────────
--
-- An armed (reminder_sent_at IS NULL) reminder on a task or an event is a data
-- design: the user was promised an alert, and a migration must not disarm the
-- promise. Each armed parent row produces ONE workspace_reminder row with the
-- parent's values (which may be absolute `remind_at` or the relative pair);
-- notification channels stay the current default (in-app), because that is
-- what the user asked for before this feature existed. The owner_id column
-- references the parent's PK so the sweep's join is one indexed lookup, and
-- the outcome is idempotent (`ON CONFLICT DO NOTHING` at three levels) if the
-- migration is reconstructed or run twice. The armed rows are carried, not
-- left on the parents, because the parent columns stay exactly as 13810 wrote
-- them — see below — and the sweep reads ONLY workspace_reminder. Two readers
-- of one truth is how the duplication and the "which is armed" confusion
-- start, and this migrates the promise, not its storage.
--
-- ── WHAT HAPPENS TO THE OLD COLUMNS ─────────────────────────────────────────
--
-- The parent columns are KEPT, not dropped. A migration in a live tenant that
-- deletes columns every consuming statement names is an outage masquerading
-- as housekeeping; 13810 made the columns part of the API. The old pair is
-- not the source of truth for any new write — Task/Event writes now write
-- rows — but reads downgrade cleanly: `task.reminder_minutes` and
-- `task.remind_at` continue to answer "the one reminder, if you wrote only
-- one" so today.praxisls.com's older client does not read NULL, and the
-- service back-fills the parent columns from the first reminder row when
-- there is exactly one. The index on each parent's remind_at pair is kept so
-- historical consumers (including the pre-upgrade deploy version) do not
-- degrade, and is no longer the main sweep path. The 13810 partial indexes
-- remain — they stop being consulted when every writer puts rows here.
--
-- ── WHY NO SENT-FLAG NORMALISATION ──────────────────────────────────────────
--
-- We deliberately did not centralise deliverability state on the parent (a
-- per-parent `reminders_sent`). "What was sent, not what was armed" is part
-- of the table's invariants — and it has to be: stamping the row that fired
-- on a shared parent is what 13810 was explicitly designed against (the
-- sweep punches its timetable, and a false punch-card silences every later
-- reminder). Sent-at is row-level; the parent's three-column pair is its
-- deprecated ancestor's best-effort projection.
--
-- DOWN carries armed reminders BACK to the parent rows when no prior
-- reminder relation existed, so the reader of a pre-13880 deployment sees the
-- same promise the armed row made — it does not revert the table, because
-- the table itself is a data structure and not behavior.

CREATE TABLE IF NOT EXISTS workspace_reminder (
  workspace_reminder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The polymorphic owner. Two FKs would read clean and be wrong: the two
  -- owners differ in sweep rule (a task's assignee-or-creator vs. an event's
  -- organiser and participants), in anchor (due_at vs. start_at), and in
  -- occurrence semantics (an event occurrence is created per spawn; a task
  -- occurrence is the series' next row). Anything-tight (a union FK pair or
  -- a constrained composite) ends up copying the distinction two tables
  -- were meant to avoid. The CHECK pins the vocabulary; the join is by
  -- owner_type choice inside the sweep.
  owner_type           text NOT NULL CHECK (owner_type IN ('task', 'calendar_event')),
  owner_id             uuid NOT NULL,

  -- The reminder itself. A row with `reminder_minutes` set is RELATIVE, not
  -- "X minutes after now": the instant is computed from the owner's due /
  -- start at sweep-or-spawn time AND on every spawn, and so is re-armed
  -- against the new date automatically. A row with `remind_at` set is
  -- ABSOLUTE: it fires at that instant and is finished. Exactly one of the
  -- two is non-null; both-null would be a reminder for no date, and
  -- both-set would leave two answers to "when".
  reminder_minutes     integer CHECK (reminder_minutes IS NULL OR reminder_minutes >= 0),
  remind_at            timestamptz CHECK (num_nulls(reminder_minutes, remind_at) = 1),

  -- NULL = ARMED, non-null = delivered-or-stamped. The sweep stamps the row
  -- even when delivery fails (a poison row cannot block a 200-row sweep);
  -- an edit that moves the reminder clears it, which is how a moved task
  -- re-arms its reminders. Never set on INSERT. The column-level check
  -- relies on the write path, not on DDL.
  reminder_sent_at     timestamptz,

  -- A three-row budget, written at the row and enforced at the parent: the
  -- service refuses a fourth with a user-facing error. A per-row DDL cap
  -- would need a trigger, and a trigger is behavior stored in the database
  -- where the sweep's relation implies it; the application rule is the
  -- honest place for a product cap. See tasks.service.reminders/writeReminders.
  ordinal              integer NOT NULL CHECK (ordinal BETWEEN 1 AND 3),

  -- In-app decoration for the reminder row itself (a badge, a named preset
  -- or "7 days before"). The row round-trips asd readable, so the dialog
  -- shows "the morning before" rather than "1440 minutes before", and the
  -- sweep stamps nothing into prose it later reads back into behavior.
  label                text,

  -- Email as an additional channel for THIS reminder. The recipient's
  -- ordinary per-category preference is otherwise authoritative; this is the
  -- recorded override, stamped at write with the actor. Plain simple and
  -- opt-in, the parent never says it for you, and the row names who did.
  email                boolean NOT NULL DEFAULT false,

  -- "Just this one" or "this and future occurrences" — participation in the
  -- recurrence of the owner. SERIES rows re-materialise per spawn (the sweep
  -- creates one fresh row per occurrence with a re-computed remind_at —
  -- this row is the series' template) and are what a user gets for "the
  -- morning of every Monday". THIS rows attach to the concrete occurrence
  -- and fire once. The distinction genuinely changes behaviour, so it is on
  -- the table rather than derived from `reminder_minutes` alone, because a
  -- user who edits "one occurrence" must not silently become series-level
  -- by inserting a relative row.
  scope                text NOT NULL DEFAULT 'this' CHECK (scope IN ('this', 'series')),

  -- A reminder is not silenced by an export of the record; it is silenced
  -- the row's own removal. Soft-delete rather than CASCADE-only: the sweep's
  -- armed set is a partial index, and a hard deletion would make what was
  -- armed invisible from what was never there — which is the failure mode
  -- the sweep is built to avoid. Soft and expires-with-parent on the
  -- owner's is_deleted collateral are why no extra path is needed for
  -- "when the task is deleted".
  is_deleted           boolean NOT NULL DEFAULT false,

  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE workspace_reminder IS
  'One per (task|calendar_event, ordinal), max 3 per owner. Sweep reads rows WHERE remind_at <= now() AND reminder_sent_at IS NULL AND is_deleted = false. Relations and series-spawned rows share the table by owner_type so one index serves both. 13880.';
COMMENT ON COLUMN workspace_reminder.owner_type IS
  'task = a Workspace task; calendar_event = a Workspace event. Not a free-text entity_type: the sweep joins with per-owner rules.';
COMMENT ON COLUMN workspace_reminder.reminder_minutes IS
  'Relative preset (minutes before the owner due/start). NULL on an absolute reminder. Mutually exclusive with remind_at; a relative row re-materialises per occurrence when the owner spawns.';
COMMENT ON COLUMN workspace_reminder.remind_at IS
  'Absolute fire instant. NULL on a relative reminder; a timezone-less wall input is converted by workspace.time.toInstant on the tenant clock before arriving here.';
COMMENT ON COLUMN workspace_reminder.reminder_sent_at IS
  'NULL = ARMED. Stamped by the sweep even when delivery failed, so a poison row cannot block the 200-row batch; cleared by an edit that moves the reminder, which is how a moved due date re-arms it.';
COMMENT ON COLUMN workspace_reminder.email IS
  'This reminder also wants email. Override of the recipient EMAIL preference for this one reminder only, at the author''s explicit choice. Stamped by actor at write.';
COMMENT ON COLUMN workspace_reminder.scope IS
  'this = one occurrence only; series = re-materialise per spawn, the template for recurring reminders (the morning of every day, e.g.).';

-- The sweep: armed, due, for whichever owner shape the join answers. The
-- partial index keeps it one compact scan per tick, the same shape 13810
-- kept per parent; without it two tables would union two partial scans and
-- the armed set would be planner-composed rather than the same thing as the
-- rest of the tick.
CREATE INDEX IF NOT EXISTS idx_workspace_reminder_due
  ON workspace_reminder (remind_at)
  WHERE is_deleted = false AND reminder_sent_at IS NULL AND remind_at IS NOT NULL;

-- Reads per owner — the dialog, the detail read, the row cap. Ordering is by
-- ordinal so "first, second and third" round-trip stably.
CREATE INDEX IF NOT EXISTS idx_workspace_reminder_owner
  ON workspace_reminder (owner_type, owner_id, ordinal)
  WHERE is_deleted = false;

-- The exception: only one SERIES template per (owner, ordinal) — a second
-- one would leave two "re-materialise this" rows on the same slot and the
-- sweep would materialise what one template was meant to do twice. Partial
-- because per-occurrence rows are expected to duplicate ordinals
-- legitimately (each is one instance).
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_reminder_series_slot
  ON workspace_reminder (owner_type, owner_id, ordinal)
  WHERE is_deleted = false AND scope = 'series';

-- ============================================================================
-- CARRY ACROSS — the armed reminders 13810 already promised.
-- The columns the rows write (owner_type, owner_id, reminder_minutes,
-- remind_at, reminder_sent_at, ordinal=1, scope='series' for a relative pair,
-- scope='this' for an absolute row, email=false, created/updated from the
-- parent's created_at/updated_at). is_deleted follows the parent's, so an
-- armed reminder on a soft-deleted record does not silently re-appear and
-- the deletion later reads as deletion. The idempotency is the owner's
-- one-reminder identity (owner + ordinal 1); a heuristic conflict target
-- would be clever and wrong (two absolute rows differ meaningfully; a
-- single pair is what 13810 supported).
-- ============================================================================

-- Tasks with an armed one-column reminder.
INSERT INTO workspace_reminder (
  owner_type, owner_id, reminder_minutes, remind_at, reminder_sent_at,
  ordinal, scope, email, is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
  'task', t.task_id, t.reminder_minutes, t.remind_at, t.reminder_sent_at,
  1, CASE WHEN t.reminder_minutes IS NOT NULL THEN 'series' ELSE 'this' END,
  false, t.is_deleted, t.created_by, t.created_by, t.created_at, t.updated_at
FROM task t
WHERE t.reminder_sent_at IS NULL
  AND (t.reminder_minutes IS NOT NULL OR t.remind_at IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Events with an armed one-column reminder — same shape, separate insert for
-- the same reason the sweep keeps per-owner rules: the owner's identity is
-- not the relation's, and folding both into one SELECT statement
-- union'd would make the rule "read everything armed" at the migration
-- itself. (Writing the rule twice is the price of keeping the two voters
-- distinct.)
INSERT INTO workspace_reminder (
  owner_type, owner_id, reminder_minutes, remind_at, reminder_sent_at,
  ordinal, scope, email, is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
  'calendar_event', e.calendar_event_id, e.reminder_minutes, e.remind_at,
  e.reminder_sent_at,
  1, CASE WHEN e.reminder_minutes IS NOT NULL THEN 'series' ELSE 'this' END,
  false, e.is_deleted, e.created_by, e.created_by, e.created_at, e.updated_at
FROM calendar_event e
WHERE e.reminder_sent_at IS NULL
  AND (e.reminder_minutes IS NOT NULL OR e.remind_at IS NOT NULL)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- EVENT TYPES — the invitation half of "participants receive one message".
-- Audit/emit keys ride the same catalogue as the reminder sweep's own keys.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('calendar_event.participant_invited', 'MOD-00A', 'Calendar event invitation sent', false, false),
 ('calendar_event.participant_responded', 'MOD-00A', 'Calendar event response recorded', false, false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   -- the armed sweep query is the same one index scan, whatever the owner
--   EXPLAIN SELECT owner_type, owner_id FROM workspace_reminder
--     WHERE is_deleted = false AND reminder_sent_at IS NULL
--       AND remind_at <= now() + interval '10 minutes';
--     -- expects an Index Scan on idx_workspace_reminder_due
--   -- the series slot cannot be taken twice
--   INSERT INTO workspace_reminder (owner_type, owner_id, reminder_minutes, ordinal, scope)
--     VALUES ('task', gen_random_uuid(), 600, 1, 'series');
--   INSERT INTO workspace_reminder (owner_type, owner_id, reminder_minutes, ordinal, scope)
--     VALUES ('task', <same>, 600, 1, 'series');  -- 23505
--   -- both-set and both-null reminders are refused
--   INSERT INTO workspace_reminder (owner_type, owner_id, ordinal, scope)
--     VALUES ('task', gen_random_uuid(), 1, 'this');  -- 23514 num_nulls CHECK
--   -- 13880 rows for every previously armed task/event, scoped by the parent
--   SELECT owner_type, count(*), count(*) FILTER (WHERE scope = 'series')
--     FROM workspace_reminder GROUP BY owner_type;
--
-- DOWN
--   -- Return armed reminders to the parent columns the older deploy reads.
--   -- One reminder row per owner maps back to the single slot 13810 had;
--   -- ordinal 1 is the one carried by the migration itself.
--   UPDATE task t
--      SET reminder_minutes = r.reminder_minutes,
--          remind_at        = r.remind_at,
--          reminder_sent_at = r.reminder_sent_at
--     FROM workspace_reminder r
--    WHERE r.owner_type = 'task' AND r.owner_id = t.task_id AND r.ordinal = 1;
--   UPDATE calendar_event e
--      SET reminder_minutes = r.reminder_minutes,
--          remind_at        = r.remind_at,
--          reminder_sent_at = r.reminder_sent_at
--     FROM workspace_reminder r
--    WHERE r.owner_type = 'calendar_event' AND r.owner_id = e.calendar_event_id
--      AND r.ordinal = 1;
--   DROP TABLE IF EXISTS workspace_reminder;
--   -- Nothing armed or sent is destroyed in the DOWN direction-of-fall: the
--   -- armed rows the migration carried ALSO lived on the parents before it
--   -- ran, which is exactly what this block restores into place.
-- ============================================================================
