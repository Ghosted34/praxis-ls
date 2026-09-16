-- ============================================================================
-- TENANT DB — 13810 My Workspace: tasks and calendar events.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- My Workspace (MOD-00A) has been described in code since it was written as
-- "the queue-of-work surface" — but the queue it could show was only ever
-- OTHER people's machinery: `approval_task` rows awaiting a decision and
-- unread notifications. There was no way for a user to put a piece of work on
-- their own desk, and no place for a dated commitment to live. Those two
-- gaps are what this closes.
--
--   task                  what I have to do
--   task_subtask          the steps inside one
--   task_watcher          who else gets told when it moves
--   calendar_event        when something happens
--   calendar_participant  who is in the room
--
-- ── WHY TASKS ARE NOT `approval_task` ──────────────────────────────────────
--
-- `approval_task` is a step in a workflow: it is created by the engine when a
-- document reaches a step, it is closed by a decision, and its lifetime is
-- owned by the instance. A task here is the opposite — a person writes it, a
-- person closes it, and no workflow knows it exists. Sharing the table would
-- have meant every query on one carrying a discriminator for the other, and a
-- workflow re-run becoming able to touch a human's to-do list.
--
-- They DO meet, on purpose: a task may POINT at a workflow step
-- (entity_type 'approval_task') so that "approve this" can sit on someone's
-- desk as work rather than only as a queue, and the entity link is what makes
-- the row clickable. That is a reference, not a foreign key — see below.
--
-- ── WHY `entity_type` + `entity_id` AND NOT A COLUMN PER KIND ──────────────
--
-- A task is usually ABOUT something: a costing, a transit order, a lead. The
-- alternative is a nullable FK per entity kind, which is fifteen columns that
-- are fourteen-NULLs wide and a CHECK constraint listing every combination.
-- A type-plus-id pair is what `event_log`, `notification` and `immutable_ledger`
-- already carry, so the shape is the house shape — and critically it is the
-- shape `packages/shared/rules/entity-route.js` already turns into a screen.
-- A task stamped `entity_type='costing'` therefore deep-links with NO new
-- mapping, and a route added next year becomes reachable from tasks written
-- today. The cost is that the DB cannot enforce the target exists; that is
-- the same trade the other three tables made, and a dangling reference
-- degrades to a task with no link rather than to a broken screen.
--
-- ── WHY REMINDERS ARE TWO COLUMNS AND NOT A QUEUE ──────────────────────────
--
-- `remind_at` is WHEN, `reminder_sent_at` is WHETHER. NULL in the second means
-- ARMED. That pair is the whole mechanism:
--
--   · the sweep is one indexed partial scan (`WHERE remind_at <= now() AND
--     reminder_sent_at IS NULL`) with no state machine to get wrong;
--   · it is idempotent by construction — a sweep that runs twice, or two
--     workers racing, cannot double-fire, because the row stops matching the
--     predicate the moment it is stamped;
--   · moving a due date RE-ARMS by setting `reminder_sent_at = NULL`, which is
--     one UPDATE rather than cancelling and re-creating a scheduled job;
--   · a reminder can never be lost to a restart, because nothing is held in
--     memory. The table IS the queue.
--
-- The partial index is on the armed rows only. In a tenant where 99% of
-- reminders have fired, the sweep reads 1% of the index — and it reads the
-- same 1% every minute, which is the point.
--
-- ── WHY SOFT DELETE ON `task` ONLY ─────────────────────────────────────────
--
-- A deleted task is deleted for good: `task_subtask` and `task_watcher`
-- cascade, so there is nothing left to render and nothing that a restore
-- could give back. A deleted EVENT is different — it has participants who
-- were told it was happening, and it may be the record of a meeting that took
-- place. So `calendar_event` is soft-deleted and stays queryable for history,
-- while the partial indexes keep it out of every live read.
--
-- ── NO `business` / `brand` COLUMN ─────────────────────────────────────────
--
-- Tenancy in this product is a database per tenant (`req.tenantDb`), so a row
-- here is already confined to one company. A brand column would be a second,
-- weaker answer to a question the connection has already answered.
--
-- ── NO `contact_id` ON PARTICIPANTS ────────────────────────────────────────
--
-- There is no `contact` table in this schema — the CRM entity is `lead`, and a
-- lead is a prospect, not somebody you invite to a fitting. An external
-- attendee is therefore a NAME (`external_name`) rather than a reference:
-- honest about what we know, and it cannot dangle. If a real contacts module
-- lands, that column gains an FK without a rewrite.
--
-- Idempotent: every statement is guarded, so this is safe to re-run and
-- produces the same state as a first run.
-- ============================================================================

-- ── 1. TASK ────────────────────────────────────────────────────────────────
--
-- Status is a KANBAN vocabulary, not a time-box one. An earlier design in this
-- product's history used inbox/today/this_week/later, which conflates WHERE a
-- task is in its life with WHEN it is due — and then a task due today that
-- slipped had nowhere to live. Status says how far along it is; `due_at` says
-- when it is wanted. The two are independent, and the UI's "Overdue" section
-- is a JOIN of the two rather than a value of either.
CREATE TABLE IF NOT EXISTS task (
  task_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  description      text,

  status           text        NOT NULL DEFAULT 'TO_DO'
                   CHECK (status IN ('TO_DO','IN_PROGRESS','IN_REVIEW','DONE','CANCELLED')),
  priority         text        NOT NULL DEFAULT 'NORMAL'
                   CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),

  -- Who it is on. NULL is a real state: a task you have written down but not
  -- handed over. Visibility of NULL-assigned tasks is a service decision, not
  -- a schema one.
  assigned_to      uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,
  -- RESTRICT, not CASCADE: deleting a user must not silently delete the record
  -- that they asked for the work. The row stays and shows its creator by id.
  created_by       uuid        NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,

  due_at           timestamptz,
  completed_at     timestamptz,

  -- One level of nesting is enough for a checklist-style parent. Deliberately
  -- NOT recursive: `task_subtask` is the breakdown, and a task tree deeper
  -- than two is a project, which is a different product.
  parent_task_id   uuid        REFERENCES task(task_id) ON DELETE CASCADE,

  -- The record this task is about. Free text by design — see the header.
  entity_type      text        CHECK (entity_type IS NULL OR char_length(entity_type) <= 40),
  entity_id        uuid,

  -- A personal task is on your desk and nobody else's, even if your role would
  -- otherwise let you see the team's. Enforced in the repo, flagged here.
  is_personal      boolean     NOT NULL DEFAULT false,

  -- Department/branch, so "my team's tasks" means the team rather than "the
  -- tenant". NO FOREIGN KEY, deliberately: `scope` is IDENTITY data living in
  -- the live schema while this table is per-environment, so an FK would point
  -- across that boundary — the same reasoning as 0489/0490, which stamped
  -- scope_id on employee/vacancy/purchase_request the same way. NULL means
  -- "not assigned to a part of the company" and stays visible to everyone.
  scope_id         uuid,

  -- ── the armed-reminder pair, see header ──
  -- Minutes BEFORE the anchor (due_at) rather than an absolute instant, so
  -- that moving the due date moves the reminder with it without a second
  -- write. `remind_at` is the RESOLVED instant and is what the sweep reads;
  -- keeping both means the sweep needs no arithmetic and the editor needs no
  -- recompute-on-read.
  reminder_minutes integer     CHECK (reminder_minutes IS NULL OR reminder_minutes >= 0),
  remind_at        timestamptz,
  reminder_sent_at timestamptz,

  is_deleted       boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN task.remind_at IS
  'Resolved instant the reminder fires. Derived from due_at - reminder_minutes when not set explicitly. The sweep reads THIS, never reminder_minutes.';
COMMENT ON COLUMN task.reminder_sent_at IS
  'NULL = ARMED. Stamped by the reminder sweep even when delivery fails, so a row can never wedge the sweep; cleared back to NULL by any edit that moves remind_at, which is how a rescheduled task re-arms.';
COMMENT ON COLUMN task.entity_type IS
  'Prefix of the record this task is about (costing, transit_order, lead, approval_task…). Resolved to a screen by packages/shared/rules/entity-route.js. Free text: a dangling value degrades to a task with no link, not to a broken screen.';

-- The live list. Every read the UI makes is "this tenant, not deleted", so the
-- predicate is IN the index rather than applied after.
CREATE INDEX IF NOT EXISTS idx_task_live           ON task (status, due_at)         WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_assigned       ON task (assigned_to, status)     WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_created_by     ON task (created_by, status)      WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_due            ON task (due_at)                  WHERE is_deleted = false AND due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_entity         ON task (entity_type, entity_id)  WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_parent         ON task (parent_task_id)          WHERE parent_task_id IS NOT NULL;
-- "My team's tasks". Partial, because an unassigned task is the common case
-- and indexing NULLs would buy nothing.
CREATE INDEX IF NOT EXISTS idx_task_scope          ON task (scope_id)                WHERE is_deleted = false AND scope_id IS NOT NULL;
-- The sweep. Armed rows only, oldest first — the index the every-minute job
-- reads, and it holds only work that has not fired yet.
CREATE INDEX IF NOT EXISTS idx_task_reminder_due   ON task (remind_at)
  WHERE is_deleted = false AND reminder_sent_at IS NULL AND remind_at IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_task_updated BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. SUBTASK ─────────────────────────────────────────────────────────────
--
-- A step inside a task. No status column: a step is done or it is not, and a
-- three-state step is a task wearing a hat. `completed_at` carries the when.
CREATE TABLE IF NOT EXISTS task_subtask (
  task_subtask_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid        NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  title           text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  is_done         boolean     NOT NULL DEFAULT false,
  -- Smallint, not integer: a task with 32k steps is not a task. Ordering is
  -- explicit rather than created_at so a step can be moved without rewriting
  -- the timestamps that mean "when it was written".
  display_order   smallint    NOT NULL DEFAULT 0,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_subtask_task ON task_subtask (task_id, display_order);

-- ── 3. WATCHER ─────────────────────────────────────────────────────────────
--
-- Somebody who is told when the task moves without owning it. A pure join, so
-- the primary key IS the pair and a duplicate watch is not expressible rather
-- than being prevented by application code.
CREATE TABLE IF NOT EXISTS task_watcher (
  task_id    uuid        NOT NULL REFERENCES task(task_id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_watcher_user ON task_watcher (user_id);

-- ── 4. CALENDAR EVENT ──────────────────────────────────────────────────────
--
-- `event_type` is an OPEN vocabulary rather than a CHECK list. Every other
-- enum here is a state machine — a value the code branches on, where an
-- unknown one is a bug. Event type is a LABEL: it picks a colour and a filter
-- chip, and nothing behaves differently between a fitting and a photoshoot.
-- Constraining it would mean a migration every time a tenant's business does
-- something new, to change a word on a chip. The list the UI offers lives in
-- the client, where adding one is a one-line change.
CREATE TABLE IF NOT EXISTS calendar_event (
  calendar_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  event_type        text        NOT NULL DEFAULT 'other',
  location          text,
  description       text,

  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  -- The DB is the last line of defence on an inverted range. A negative-length
  -- event is not a rendering problem to be papered over, it is a row that
  -- would sort into every overlap query twice.
  CONSTRAINT calendar_event_range CHECK (end_at >= start_at),

  all_day           boolean     NOT NULL DEFAULT false,
  -- Stored as written (an iCal RRULE). NOT expanded into rows: a weekly
  -- meeting for two years is 104 rows that all have to move when the series
  -- moves. Expansion is a read-time concern and belongs in the service.
  recurrence_rule   text,

  created_by        uuid        REFERENCES app_user(user_id) ON DELETE SET NULL,

  -- Same pair as `task`, anchored on `start_at` — see the header.
  reminder_minutes  integer     CHECK (reminder_minutes IS NULL OR reminder_minutes >= 0),
  remind_at         timestamptz,
  reminder_sent_at  timestamptz,

  entity_type       text        CHECK (entity_type IS NULL OR char_length(entity_type) <= 40),
  entity_id         uuid,

  is_deleted        boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN calendar_event.reminder_sent_at IS
  'NULL = ARMED. Same mechanism as task.reminder_sent_at; see that column.';
COMMENT ON COLUMN calendar_event.event_type IS
  'Open vocabulary, deliberately not a CHECK list: it selects a colour and a filter, nothing branches on it. The offered list lives in the client.';

-- The month/week grid is a range scan on start_at, always scoped to live rows.
CREATE INDEX IF NOT EXISTS idx_calendar_event_range ON calendar_event (start_at) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_calendar_event_creator ON calendar_event (created_by) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_calendar_event_entity  ON calendar_event (entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_event_reminder_due ON calendar_event (remind_at)
  WHERE is_deleted = false AND reminder_sent_at IS NULL AND remind_at IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_calendar_event_updated BEFORE UPDATE ON calendar_event FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. PARTICIPANT ─────────────────────────────────────────────────────────
--
-- Exactly one of `user_id` / `external_name`, enforced by the CHECK. Both
-- NULL is a participant who is nobody; both set is a person counted twice.
--
-- The UNIQUE index uses COALESCE because Postgres treats NULLs as distinct in
-- a plain UNIQUE, which would let the same external name be added to one event
-- an unlimited number of times. The sentinel makes "no user" comparable.
CREATE TABLE IF NOT EXISTS calendar_participant (
  calendar_participant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id       uuid        NOT NULL REFERENCES calendar_event(calendar_event_id) ON DELETE CASCADE,
  user_id                 uuid        REFERENCES app_user(user_id) ON DELETE CASCADE,
  external_name           text        CHECK (external_name IS NULL OR char_length(btrim(external_name)) BETWEEN 1 AND 160),
  -- 'INVITED' is the honest default: we have not asked yet, let alone heard
  -- back. `responded_at` stays NULL until they do, which is what tells the
  -- organiser the difference between "declined" and "hasn't looked".
  response_status         text        NOT NULL DEFAULT 'INVITED'
                          CHECK (response_status IN ('INVITED','ACCEPTED','DECLINED','TENTATIVE')),
  responded_at            timestamptz,
  is_organiser            boolean     NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_participant_who CHECK (
    (user_id IS NOT NULL AND external_name IS NULL)
    OR (user_id IS NULL AND external_name IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_participant_once ON calendar_participant (
  calendar_event_id,
  COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(btrim(lower(external_name)), '')
);
CREATE INDEX IF NOT EXISTS idx_calendar_participant_event ON calendar_participant (calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_participant_user  ON calendar_participant (user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- VERIFY
--   -- enums reject a made-up value
--   INSERT INTO task (title, created_by, status)
--     VALUES ('x', '00000000-0000-0000-0000-000000000001', 'SOMEDAY');  -- 23514
--   -- an inverted event is refused
--   INSERT INTO calendar_event (title, start_at, end_at)
--     VALUES ('x', now(), now() - interval '1 hour');                   -- 23514
--   -- a participant must be somebody
--   INSERT INTO calendar_participant (calendar_event_id) VALUES (NULL);  -- 23502/23514
--   -- the sweep predicate is index-backed
--   EXPLAIN SELECT task_id FROM task
--     WHERE remind_at <= now() AND reminder_sent_at IS NULL AND is_deleted = false;
--     -- expects a Bitmap/Index Scan on idx_task_reminder_due
--
-- DOWN
--   DROP TABLE IF EXISTS calendar_participant;
--   DROP TABLE IF EXISTS calendar_event;
--   DROP TABLE IF EXISTS task_watcher;
--   DROP TABLE IF EXISTS task_subtask;
--   DROP TABLE IF EXISTS task;
--   -- My Workspace loses tasks and calendar and returns to approvals +
--   -- notifications only. Nothing outside MOD-00A reads these five tables.
-- ============================================================================
