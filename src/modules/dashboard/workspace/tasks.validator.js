"use strict";
/**
 * My Workspace — input validation for tasks and calendar events (MOD-00A).
 *
 * ── WHAT THIS LAYER DECIDES, AND WHAT IT DELIBERATELY DOES NOT ─────────────
 *
 * Shape, length and vocabulary. Not meaning, and not time.
 *
 * A datetime is accepted here as ANY of the three shapes a caller can produce —
 * `2026-09-15T17:00:00Z`, `…+01:00`, or the bare `2026-09-15T17:00` that
 * `<DateTimeField>` writes — and is passed through UNCHANGED. Turning it into
 * an instant needs the tenant's workplace clock, which is a database read, and
 * a Zod transform cannot await one. So the service resolves it
 * (workspace.time.js). Validating the format here still earns its place: a
 * malformed value is a 422 naming the field rather than a null that quietly
 * stores "no due date".
 *
 * `event_type` is a free string, matching the column: it selects a colour and a
 * filter chip, nothing branches on it, and constraining it would mean a
 * migration every time a tenant's business does something new.
 */

const { z } = require("zod");
const { body, query, strictQuery, filters } = require("../../../shared/http/validate");

const STATUSES = ["TO_DO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const RESPONSES = ["INVITED", "ACCEPTED", "DECLINED", "TENTATIVE"];
/** Who the caller is asking to see. Narrowed to what they may see in the service. */
const AUDIENCES = ["mine", "team", "all"];

/**
 * A datetime as a person's UI can produce one. Offset optional on purpose —
 * its absence means "read this on the tenant's clock", not "assume UTC".
 */
const dt = (msg) =>
  z
    .string()
    .trim()
    .regex(
      /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
      msg,
    );

const DATETIME_MSG = "expected YYYY-MM-DD, YYYY-MM-DDTHH:mm, or an ISO 8601 instant";

/**
 * An iCal RRULE, accepted as a free string. Meaning is NOT validated here — a
 * RRULE is meaningful only against the tenant's clock, and resolving it needs a
 * database read a Zod schema cannot await. The service parses it
 * (recurrence.js) and returns a 422 naming the part when it is not one this
 * product implements. Shape/length are still checked here so an absurd value is
 * rejected before it touches a connection.
 */
const recurrenceRule = z.string().trim().min(1).max(500);

/** Whether an edit applies to this one occurrence or the whole series (13840). */
const SERIES_SCOPE = ["this", "series"];

const subtask = z
  .object({
    title: z.string().trim().min(1, "a step needs a title").max(300),
    display_order: z.number().int().min(0).max(32000).optional(),
    // A step (milestone) may carry its own deadline. Nullable so an empty date
    // clears it; resolved to an instant on the tenant's clock by the service.
    due_at: dt(DATETIME_MSG).nullable().optional(),
  })
  .strict();

const participant = z
  .object({
    user_id: z.string().uuid().optional(),
    external_name: z.string().trim().min(1).max(160).optional(),
    is_organiser: z.boolean().optional(),
  })
  .strict()
  // Exactly one of the two, mirroring the CHECK on the table. Enforced here as
  // well so the user is told which field is wrong rather than getting a
  // 23514 from Postgres about a constraint they have never heard of.
  .refine((p) => Boolean(p.user_id) !== Boolean(p.external_name), {
    message: "invite a user OR name an external attendee, not both and not neither",
  });

/**
 * One reminder row as the dialog sends it (13890). Relative or absolute is
 * decided HERE — never both, never neither — so the table's own CHECK
 * (`num_nulls(reminder_minutes, remind_at) = 1`) is a belt, not the user's
 * first grammar lesson. `email` is opt-in per row and `scope: 'series'` is
 * the re-materialise-per-occurrence choice; both ride the row so a reminder
 * remembers its own intent rather than the parent's.
 */
const reminder = z
  .object({
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    email: z.boolean().optional(),
    scope: z.enum(SERIES_SCOPE).optional(),
    label: z.string().trim().max(80).nullable().optional(),
  })
  .strict()
  .refine((r) => {
    const hasRelative = r.reminder_minutes !== null && r.reminder_minutes !== undefined;
    const hasAbsolute = r.remind_at !== null && r.remind_at !== undefined && r.remind_at !== "";
    return hasRelative !== hasAbsolute;
  }, { message: "a reminder is minutes-before OR at a time, not both and not neither" });

/** PR 3's several-reminders vocabulary: at most three per record. */
const reminders = z.array(reminder).max(3, "at most three reminders per record");

/* ══════════════════════════════════ TASKS ════════════════════════════════ */

/** The stage set of 13950 — uuids, deduplicated by the service, bounded here. */
const stageSet = z.array(z.string().uuid()).max(20).optional();

const taskCreate = z
  .object({
    title: z.string().trim().min(1, "a task needs a title").max(300),
    // `.nullable()` because the dialog sends an explicit null for empty Notes,
    // and optional alone 422s on a null that is present.
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    due_at: dt(DATETIME_MSG).nullable().optional(),
    parent_task_id: z.string().uuid().optional(),
    entity_type: z.string().trim().max(40).optional(),
    entity_id: z.string().uuid().optional(),
    // The operations file this work is IN, and optionally the stage of its
    // chain (13920). Distinct from the pair above, which is what the task
    // POINTS AT — a task can legitimately have both. Nullable because the
    // dialog sends an explicit null when the picker is cleared.
    dossier_id: z.string().uuid().nullable().optional(),
    milestone_instance_id: z.string().uuid().nullable().optional(),
    // The stages of the file's chain the work belongs to — one or several
    // (13950). Supersedes the single column above when present; an empty list
    // is a real statement ("no stage"). Twenty is more than any chain has.
    milestone_instance_ids: stageSet,
    is_personal: z.boolean().optional(),
    // `reminder_minutes` is RELATIVE (before the due date) and `remind_at` is
    // ABSOLUTE. Sending both is allowed — the absolute one wins — because the
    // reminder picker needs to say "1 day before, at 09:00", which is a
    // relative intent with an absolute answer. `reminders` is PR 3's several
    // rows (up to three per record, email/scope/label per row); the pair is
    // 13810's vocabulary, kept so the older client still arms one reminder.
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    reminders: reminders.optional(),
    subtasks: z.array(subtask).max(50).optional(),
    recurrence_rule: recurrenceRule.nullable().optional(),
  })
  .strict();

const taskUpdateShape = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    due_at: dt(DATETIME_MSG).nullable().optional(),
    entity_type: z.string().trim().max(40).nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    dossier_id: z.string().uuid().nullable().optional(),
    milestone_instance_id: z.string().uuid().nullable().optional(),
    milestone_instance_ids: stageSet,
    is_personal: z.boolean().optional(),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    reminders: reminders.optional(),
    recurrence_rule: recurrenceRule.nullable().optional(),
    series: z.enum(SERIES_SCOPE).optional(),
  })
  .strict();
const NOTHING_TO_UPDATE = { message: "nothing to update" };
const taskUpdate = taskUpdateShape.refine((v) => Object.keys(v).length > 0, NOTHING_TO_UPDATE);

// The effective audience rides on the body so a Team/All card moved from the
// board reaches the server with the reach the board was rendered at (B-03).
// It is a REQUEST, never authority: `resolveAudience` narrows it server-side.
const statusChange = z
  .object({ status: z.enum(STATUSES), audience: z.enum(AUDIENCES).optional() })
  .strict();

const subtaskAdd = z
  .object({
    title: z.string().trim().min(1, "a step needs a title").max(300),
    display_order: z.number().int().min(0).max(32000).optional(),
    due_at: dt(DATETIME_MSG).nullable().optional(),
  })
  .strict();

// One PATCH covers both edits a step takes: ticking it done and moving its
// deadline. Kept as one schema (rather than a toggle plus a separate date
// route) because the panel does both from the same row, and `at least one
// field` mirrors taskUpdate so an empty body is a 422 naming the problem.
const subtaskPatch = z
  .object({
    is_done: z.boolean().optional(),
    due_at: dt(DATETIME_MSG).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

const watcherAdd = z.object({ user_id: z.string().uuid() }).strict();

/* ── hierarchy, dependencies and collaboration (PR 2) ────────────────────── */

/**
 * A child task. The same fields as a top-level one MINUS the structural ones.
 *
 * `parent_task_id` is absent because it is the route (`/tasks/:id/children`) —
 * accepting it in the body as well would let the two disagree, and the answer
 * to "which wins" is a bug whichever way it is decided. `is_personal` is
 * absent because a child of shared work is not a private note, and
 * `recurrence_rule` is absent because a child of a repeating parent is a
 * one-off: a series per child multiplies the board by the recurrence count.
 */
const childCreate = z
  .object({
    title: z.string().trim().min(1, "a task needs a title").max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    due_at: dt(DATETIME_MSG).nullable().optional(),
    // Omit both and the child inherits the parent's linked record; send them to
    // point the child at a different one.
    entity_type: z.string().trim().max(40).nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    // Same terms for the operations file and its stages (13920, 13950):
    // omitted means inherit, an explicit null (or []) means "this piece is
    // not on that file / those stages".
    dossier_id: z.string().uuid().nullable().optional(),
    milestone_instance_id: z.string().uuid().nullable().optional(),
    milestone_instance_ids: stageSet,
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    reminders: reminders.optional(),
    subtasks: z.array(subtask).max(50).optional(),
  })
  .strict();

/** One blocked-by edge. The blocked task is the route; this names the other end. */
const dependencyAdd = z
  .object({ depends_on_task_id: z.string().uuid() })
  .strict();

/**
 * "Proceed anyway", or withdraw it.
 *
 * The reason is optional on purpose: a required justification field produces
 * "n/a" and teaches people the form is theatre. `overridden` is explicit rather
 * than a toggle-by-presence so withdrawing an override is the same call.
 */
const dependencyOverride = z
  .object({
    overridden: z.boolean(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/**
 * A manual ping.
 *
 * `user_ids` is OPTIONAL and means "everyone already on this task". The
 * service refuses any id that is not the assignee, the creator or a watcher —
 * a task panel is not a general messaging channel, and the validator cannot
 * know who is connected to the task, so the narrowing happens there.
 */
const taskPing = z
  .object({
    user_ids: z.array(z.string().uuid()).max(50).optional(),
    message: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/**
 * Raise a blockage (13975) — "I am blocked, and here is why".
 *
 * `note` is REQUIRED and bounded at 1000: a badge with nothing behind it is
 * worse than no badge, and a thousand characters is far more room than any
 * honest hold needs ("held at customs — network down since Tuesday").
 *
 * `notify_user_ids` may name ANY user in the tenant, unlike a ping: the person
 * who can lift a customs hold is usually not on the task. Every named person
 * receives a SmartComm direct message, so the reach is recorded in the comms
 * thread rather than hidden in a delivery log — see the service's header.
 * `channel_ids` are SmartComm groups the raiser belongs to; membership is
 * enforced by comms itself at post time.
 */
const blockageRaise = z
  .object({
    note: z.string().trim().min(1, "a blockage needs an explanation").max(1000),
    estimated_resolve_at: dt(DATETIME_MSG).nullable().optional(),
    notify_user_ids: z.array(z.string().uuid()).max(50).optional(),
    channel_ids: z.array(z.string().uuid()).max(10).optional(),
    audience: z.enum(AUDIENCES).optional(),
  })
  .strict();

/**
 * Clear the hold. `resolve_note` is optional for the same reason an override
 * reason is: a forced justification produces "n/a", not an explanation.
 */
const blockageResolve = z
  .object({
    resolve_note: z.string().trim().max(500).nullable().optional(),
    audience: z.enum(AUDIENCES).optional(),
  })
  .strict();

const taskListQuery = strictQuery({
  status: filters.enum(STATUSES),
  priority: filters.enum(PRIORITIES),
  assigned_to: z.string().trim().max(64).optional(), // a uuid, or the literal "me"
  audience: filters.enum(AUDIENCES),
  entity_type: z.string().trim().max(40).optional(),
  entity_id: filters.uuid,
  // Narrow to one operations file, or to one stage of its chain (13920). The
  // file's own 360 reads its Tasks tab through this, so the tab and the
  // Analytics rollup count the same population rather than two that agree.
  dossier_id: filters.uuid,
  milestone_instance_id: filters.uuid,
  // An allow-list, not free text — it lands in an ORDER BY (tasks.repo.js).
  sort: z.enum(["due_asc", "due_desc", "created_desc", "priority_desc"]).optional(),
});

const boardQuery = strictQuery({
  assigned_to: z.string().trim().max(64).optional(),
  audience: filters.enum(AUDIENCES),
  dossier_id: filters.uuid,
  // `q` rides in from LIST_QUERY, as on every list: the board answers the same
  // free-text search the list does, so Board↔List finds the same cards.
});

/** The detail read carries the audience the list/board was rendered at (B-03). */
const taskDetailQuery = strictQuery({ audience: filters.enum(AUDIENCES) });

/**
 * The Analytics window and its bounded filters.
 *
 * Strict, like every other query here, so a filter that does nothing is a 422
 * rather than a parameter the server silently ignores while the chart claims
 * to honour it. The WINDOW is optional — the service defaults and clamps it
 * (tasks.service.resolveAnalyticsWindow), because an unbounded aggregate over
 * a tenant's whole history is a table scan reachable from a URL.
 */
const analyticsQuery = strictQuery({
  from: dt(DATETIME_MSG).optional(),
  to: dt(DATETIME_MSG).optional(),
  audience: filters.enum(AUDIENCES),
  status: filters.enum(STATUSES),
  priority: filters.enum(PRIORITIES),
  assigned_to: z.string().trim().max(64).optional(), // a uuid, or the literal "me"
  scope_id: filters.uuid,
  // Narrow every figure on the dashboard to one operations file (13920). The
  // same parameter the drill-down carries into the Tasks list, so a number
  // opened from here lands on exactly the rows it counted.
  dossier_id: filters.uuid,
});

// The window is OPTIONAL because the controller defaults it to today in the
// tenant's own clock (tasks.controller.js, getDay). The Today page sends no
// window on first load — a mandatory `from`/`to` would 422 the load before the
// default the caller clearly meant ("today") could ever run.
const dayQuery = strictQuery({
  from: dt(DATETIME_MSG).optional(),
  to: dt(DATETIME_MSG).optional(),
  audience: filters.enum(AUDIENCES),
});

// The calendar's deadline overlay: task AND subtask due dates in a window. Same
// optional-window shape as dayQuery — the controller defaults it — so the month
// grid can ask without computing a fallback the server already knows.
const deadlineQuery = strictQuery({
  from: dt(DATETIME_MSG).optional(),
  to: dt(DATETIME_MSG).optional(),
  audience: filters.enum(AUDIENCES),
});

/* ════════════════════════════ CALENDAR EVENTS ═══════════════════════════ */

const eventCreate = z
  .object({
    title: z.string().trim().min(1, "an event needs a title").max(200),
    event_type: z.string().trim().min(1).max(40).optional(),
    // Both nullable: the dialog sends an explicit null for an empty Where or
    // Notes, and optional alone 422s on a null that is present.
    location: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    start_at: dt(DATETIME_MSG),
    end_at: dt(DATETIME_MSG),
    all_day: z.boolean().optional(),
    recurrence_rule: recurrenceRule.nullable().optional(),
    entity_type: z.string().trim().max(40).optional(),
    entity_id: z.string().uuid().optional(),
    scope_id: z.string().uuid().nullable().optional(),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    reminders: reminders.optional(),
    participants: z.array(participant).max(50).optional(),
    // Book it anyway, past the clash warning. A boolean rather than a
    // permission: overriding your own double-booking is not an authority.
    force: z.boolean().optional(),
  })
  .strict();

const eventUpdateShape = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    event_type: z.string().trim().min(1).max(40).optional(),
    location: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    start_at: dt(DATETIME_MSG).optional(),
    end_at: dt(DATETIME_MSG).optional(),
    all_day: z.boolean().optional(),
    recurrence_rule: recurrenceRule.nullable().optional(),
    entity_type: z.string().trim().max(40).nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    scope_id: z.string().uuid().nullable().optional(),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    reminders: reminders.optional(),
    series: z.enum(SERIES_SCOPE).optional(),
    force: z.boolean().optional(),
  })
  .strict();
const eventUpdate = eventUpdateShape.refine((v) => Object.keys(v).length > 0, NOTHING_TO_UPDATE);

const participantAdd = z
  .object({
    user_id: z.string().uuid().optional(),
    external_name: z.string().trim().min(1).max(160).optional(),
    is_organiser: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Boolean(p.user_id) !== Boolean(p.external_name), {
    message: "invite a user OR name an external attendee, not both and not neither",
  });

const participantRespond = z.object({ status: z.enum(RESPONSES) }).strict();

// Optional window, same reason as dayQuery: the controller defaults an
// unbounded request to the current month (tasks.controller.js, listEvents).
const eventListQuery = strictQuery({
  from: dt(DATETIME_MSG).optional(),
  to: dt(DATETIME_MSG).optional(),
  event_type: z.string().trim().max(40).optional(),
  audience: filters.enum(AUDIENCES),
});

module.exports = {
  // Bodies
  taskCreate: body(taskCreate),
  taskUpdate: body(taskUpdate),
  statusChange: body(statusChange),
  subtaskAdd: body(subtaskAdd),
  subtaskPatch: body(subtaskPatch),
  watcherAdd: body(watcherAdd),
  childCreate: body(childCreate),
  dependencyAdd: body(dependencyAdd),
  dependencyOverride: body(dependencyOverride),
  taskPing: body(taskPing),
  blockageRaise: body(blockageRaise),
  blockageResolve: body(blockageResolve),
  eventCreate: body(eventCreate),
  eventUpdate: body(eventUpdate),
  participantAdd: body(participantAdd),
  participantRespond: body(participantRespond),
  // Queries — strict, so a filter that does nothing is a 422 rather than a
  // silently ignored parameter that makes a list look complete when it is not.
  taskListQuery: query(taskListQuery),
  boardQuery: query(boardQuery),
  taskDetailQuery: query(taskDetailQuery),
  analyticsQuery: query(analyticsQuery),
  dayQuery: query(dayQuery),
  deadlineQuery: query(deadlineQuery),
  eventListQuery: query(eventListQuery),
  // Exposed for tests and for the client's shared-schema gate.
  schemas: {
    // AI-facing: the task or event is in the URL for the HTTP routes, but a
    // copilot call has no URL — it passes one flat object, so the id must be IN
    // the schema. `nothing to update` becomes "nothing BUT the id".
    aiTaskUpdate: taskUpdateShape
      .extend({ task_id: z.string().uuid() })
      .refine((v) => Object.keys(v).length > 1, NOTHING_TO_UPDATE),
    aiStatusChange: statusChange.extend({ task_id: z.string().uuid() }),
    aiEventUpdate: eventUpdateShape
      .extend({ event_id: z.string().uuid() })
      .refine((v) => Object.keys(v).length > 1, NOTHING_TO_UPDATE),
    taskCreate, taskUpdate, statusChange, subtaskAdd, subtaskPatch, watcherAdd,
    childCreate, dependencyAdd, dependencyOverride, taskPing,
    taskDetailQuery, analyticsQuery,
    eventCreate, eventUpdate, participantAdd, participantRespond,
    taskListQuery, boardQuery, dayQuery, deadlineQuery, eventListQuery,
    recurrenceRule, SERIES_SCOPE,
  },
  STATUSES, PRIORITIES, RESPONSES, AUDIENCES,
};
