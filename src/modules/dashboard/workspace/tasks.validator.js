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

/* ══════════════════════════════════ TASKS ════════════════════════════════ */

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
    is_personal: z.boolean().optional(),
    // `reminder_minutes` is RELATIVE (before the due date) and `remind_at` is
    // ABSOLUTE. Sending both is allowed — the absolute one wins — because the
    // reminder picker needs to say "1 day before, at 09:00", which is a
    // relative intent with an absolute answer.
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    subtasks: z.array(subtask).max(50).optional(),
  })
  .strict();

const taskUpdate = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    due_at: dt(DATETIME_MSG).nullable().optional(),
    entity_type: z.string().trim().max(40).nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    is_personal: z.boolean().optional(),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

const statusChange = z.object({ status: z.enum(STATUSES) }).strict();

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

const taskListQuery = strictQuery({
  status: filters.enum(STATUSES),
  priority: filters.enum(PRIORITIES),
  assigned_to: z.string().trim().max(64).optional(), // a uuid, or the literal "me"
  audience: filters.enum(AUDIENCES),
  entity_type: z.string().trim().max(40).optional(),
  entity_id: filters.uuid,
});

const boardQuery = strictQuery({
  assigned_to: z.string().trim().max(64).optional(),
  audience: filters.enum(AUDIENCES),
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
    recurrence_rule: z.string().trim().max(500).optional(),
    entity_type: z.string().trim().max(40).optional(),
    entity_id: z.string().uuid().optional(),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    participants: z.array(participant).max(50).optional(),
    // Book it anyway, past the clash warning. A boolean rather than a
    // permission: overriding your own double-booking is not an authority.
    force: z.boolean().optional(),
  })
  .strict();

const eventUpdate = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    event_type: z.string().trim().min(1).max(40).optional(),
    location: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    start_at: dt(DATETIME_MSG).optional(),
    end_at: dt(DATETIME_MSG).optional(),
    all_day: z.boolean().optional(),
    recurrence_rule: z.string().trim().max(500).nullable().optional(),
    entity_type: z.string().trim().max(40).nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().optional(),
    remind_at: dt(DATETIME_MSG).nullable().optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to update" });

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
  eventCreate: body(eventCreate),
  eventUpdate: body(eventUpdate),
  participantAdd: body(participantAdd),
  participantRespond: body(participantRespond),
  // Queries — strict, so a filter that does nothing is a 422 rather than a
  // silently ignored parameter that makes a list look complete when it is not.
  taskListQuery: query(taskListQuery),
  boardQuery: query(boardQuery),
  dayQuery: query(dayQuery),
  deadlineQuery: query(deadlineQuery),
  eventListQuery: query(eventListQuery),
  // Exposed for tests and for the client's shared-schema gate.
  schemas: {
    taskCreate, taskUpdate, statusChange, subtaskAdd, subtaskPatch, watcherAdd,
    eventCreate, eventUpdate, participantAdd, participantRespond,
    taskListQuery, boardQuery, dayQuery, deadlineQuery, eventListQuery,
  },
  STATUSES, PRIORITIES, RESPONSES, AUDIENCES,
};
