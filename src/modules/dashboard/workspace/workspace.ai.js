/**
 * AI action manifest (AI_ARCHITECTURE §2) for My Workspace — Tasks & Calendar
 * (MOD-00A).
 *
 * This module was built AFTER Praxis AI shipped and never got a manifest, so
 * the copilot could not answer the most ordinary question anybody asks it:
 * "what's on my plate today". The audit filed that under I3.
 *
 * ── THE AUDIENCE BOUNDARY, WHICH IS WHY THIS FILE HAS A ctx HELPER ──────────
 *
 * `tasks.service` takes a `ctx` describing who is asking AND how far their
 * reach goes. Over HTTP, `permission_scope` and `scope_ids` are set by
 * `requirePermission` (middleware/rbac.js) — the CEO gets "all", everyone else
 * gets their organigramme closure. An AI tool call does not pass through that
 * middleware, so those two fields are NOT available here, and inventing them
 * would be inventing authority.
 *
 * So `ctx()` below supplies neither. `audiencesFor` then returns exactly
 * `["mine"]` and `resolveAudience` narrows every request to it — the assistant
 * sees the caller's own tasks and events and nobody else's. That is the safe
 * direction (AI_ARCHITECTURE §1: the AI never exceeds the calling user), and it
 * is also the useful one: "my tasks", "my week", "remind me on Thursday".
 * Widening this to team/all means deriving the caller's scope closure on the AI
 * path first, deliberately — not defaulting to "all" here.
 */
"use strict";

const service = require("./tasks.service");
const validator = require("./tasks.validator");

const MOD = "MOD-00A";

/**
 * The caller, with no reach beyond themselves. `permission_scope`/`scope_ids`
 * are deliberately absent — see the header. The read adapter passes
 * `{ user_id }` as the third argument and the write adapter passes the full
 * actor, so both shapes land here as `caller`.
 */
const ctx = (caller) => ({ user: caller || {}, permission_scope: null, scope_ids: null, audience: "mine" });

module.exports = {
  entity: "workspace_task",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_my_tasks", service: (c, p, caller) => service.listTasks(c, ctx(caller), p || {}), permission: { module: MOD, action: "view" }, describe: "The caller's own tasks. Filter by status, priority, assigned_to, a free-text q, or the record they hang off (entity_type + entity_id)." },
    { key: "get_my_task", service: (c, p, caller) => service.getTask(c, ctx(caller), p.task_id || p.id || p), permission: { module: MOD, action: "view" }, describe: "One of the caller's tasks by id, with its subtasks, watchers and dependencies." },
    { key: "my_task_board", service: (c, p, caller) => service.getBoard(c, ctx(caller), p || {}), permission: { module: MOD, action: "view" }, describe: "The caller's tasks grouped into board columns by status." },
    { key: "my_day_timeline", service: (c, p, caller) => service.dayTimeline(c, ctx(caller), { from: p.from, to: p.to }), permission: { module: MOD, action: "view" }, describe: "Tasks and calendar events merged into one chronological timeline between two datetimes." },
    { key: "my_deadlines", service: (c, p, caller) => service.deadlinesInRange(c, ctx(caller), { from: p.from, to: p.to }), permission: { module: MOD, action: "view" }, describe: "The caller's task deadlines falling in a window — what is due, and when." },
    { key: "list_my_events", service: (c, p, caller) => service.listEvents(c, ctx(caller), p || {}), permission: { module: MOD, action: "view" }, describe: "The caller's calendar events in a window, optionally filtered by event_type." },
    { key: "get_my_event", service: (c, p, caller) => service.getEvent(c, ctx(caller), p.event_id || p.id || p), permission: { module: MOD, action: "view" }, describe: "One calendar event by id, with its participants." },
  ],

  writes: [
    {
      key: "create_task",
      service: (c, p, actor) => service.createTask(c, ctx(actor), p),
      schema: validator.schemas.taskCreate,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Create a task for the caller (title, due date, priority, assignee, reminder, subtasks, recurrence). Attach it to a record with entity_type + entity_id.",
    },
    {
      key: "update_task",
      service: (c, p, actor) => (({ task_id, ...patch }) => service.updateTask(c, ctx(actor), task_id, patch))(p),
      schema: validator.schemas.aiTaskUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Amend one of the caller's tasks by id (title, due date, priority, assignee, reminder, recurrence).",
    },
    {
      key: "change_task_status",
      service: (c, p, actor) => service.changeStatus(c, ctx(actor), p.task_id, p.status),
      schema: validator.schemas.aiStatusChange,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Move a task by id to another status — this is how it is marked done.",
    },
    {
      key: "create_calendar_event",
      service: (c, p, actor) => service.createEvent(c, ctx(actor), p),
      schema: validator.schemas.eventCreate,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Put a meeting or reminder on the caller's calendar (start, end or all-day, location, participants, recurrence).",
    },
    {
      key: "update_calendar_event",
      service: (c, p, actor) => (({ event_id, ...patch }) => service.updateEvent(c, ctx(actor), event_id, patch))(p),
      schema: validator.schemas.aiEventUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Move or amend a calendar event by id. `series` decides whether one occurrence or the whole recurrence changes.",
    },
  ],
};
