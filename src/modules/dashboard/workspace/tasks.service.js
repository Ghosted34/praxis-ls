"use strict";
/**
 * My Workspace — the rules for tasks and calendar events (MOD-00A).
 *
 * ── THE ONE IDEA ───────────────────────────────────────────────────────────
 *
 * A task is a POINTER to work, not a note about it. `link_url` is derived on
 * every read from `entity_type` + `entity_id` by the shared entity-route map,
 * and it is never stored. Storing it would freeze today's routes into
 * yesterday's rows: a route that moves would leave a thousand tasks pointing at
 * the old path, and the failure is silent because the SPA catches the unknown
 * path and lands on the dashboard. Deriving it means a route added next year
 * becomes reachable from tasks written today, with no backfill.
 *
 * The same map is what notifications use, so the bell and the task panel open
 * the same screen. One map, two readers — that is the whole reason it lives in
 * packages/shared and not here.
 *
 * ── AUDIENCE ───────────────────────────────────────────────────────────────
 *
 * "Only certain roles see everyone else's" is NOT a new mechanism. It is
 * `req.permission_scope` / `req.scope_ids`, already set by
 * middleware/rbac.js from the caller's grants and their organigramme closure:
 * a caller with no scope rows is "all", a caller with them is "scoped". The
 * service reads that and never invents its own rule, because a second copy of
 * an authorisation rule is a second place to get it wrong.
 */

const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { entityRoute } = require("@praxis/shared");
const repo = require("./tasks.repo");
const events = require("./workspace.events");
const { timezoneOf, toInstant } = require("./workspace.time");
const { logger } = require("../../../config/logger");

const VALID_STATUSES = ["TO_DO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
const DONE_STATUSES = new Set(["DONE", "CANCELLED"]);

/**
 * Actor attribution for an audit row, from the caller we already hold.
 *
 * `audit()` snapshots `actor_name_snapshot` from what it is GIVEN and stores
 * NULL otherwise (shared/events/emit.js) — and a null name renders as a raw
 * UUID in the tenant-wide Audit Terminal, which is the "actors show as
 * identifiers" report. `req.user` already carries the name and email, so
 * stamping them here needs no extra query and makes a task/event row read as a
 * person rather than an id.
 */
const actorOf = (ctx) => ({
  actorUserId: ctx.user.user_id,
  actorName: ctx.user.display_name || ctx.user.email || null,
  actorEmail: ctx.user.email || null,
});

/* ── audience ─────────────────────────────────────────────────────────────── */

/**
 * Which audiences this caller may actually ask for.
 *
 * Returned to the client as well as used here, so the switch renders only the
 * options that would work. Offering "Everyone" to somebody the server would
 * quietly narrow to "mine" is a lie with a control on it.
 */
function audiencesFor(ctx) {
  const list = ["mine"];
  if (ctx.scope_ids && ctx.scope_ids.length) list.push("team");
  if (ctx.permission_scope === "all") list.push("all");
  return list;
}

/**
 * Resolve the requested audience down to one this caller is allowed.
 *
 * NARROWS rather than 403s. A user whose grants changed mid-session, or a
 * bookmarked URL carrying `?audience=all`, should see their own work — not an
 * error page. Over-reach is refused silently here because the alternative
 * (leaking) is the actual harm, and the refused user still gets a correct,
 * useful answer. The client only ever offers what `audiencesFor` returned.
 */
function resolveAudience(ctx, requested) {
  const allowed = audiencesFor(ctx);
  return allowed.includes(requested) ? requested : "mine";
}

/** The visibility bundle the repo filters on. */
function visibilityOf(ctx, audience) {
  return {
    audience,
    userId: ctx.user.user_id,
    scopeIds: ctx.scope_ids || null,
    // Personal tasks are hidden from everyone but their creator (and their
    // assignee) unless the caller is looking at the whole tenant as an
    // administrator — and even then, `is_personal` means what it says.
    personalOnly: true,
  };
}

/* ── derivation ───────────────────────────────────────────────────────────── */

/**
 * The screen a task's record lives on, or null.
 *
 * Never throws: an `entity_type` nobody has mapped yet is a normal state (the
 * map grows), and a task must still render — it simply has no link. That is
 * the honest version of the alternative, which is a task that errors.
 */
function deriveLink(row) {
  if (!row || !row.entity_type || !row.entity_id) return null;
  try {
    // The shared map speaks `type:id` refs, which is also the shape stamped on
    // the notification — so the bell and this panel cannot disagree.
    return entityRoute.urlFor(`${row.entity_type}:${row.entity_id}`) || null;
  } catch (err) {
    logger.debug({ err, entity_type: row.entity_type }, "no route for task entity");
    return null;
  }
}

/** Human name for the record a task points at, for "Open …" buttons. */
function entityLabel(entityType) {
  if (!entityType) return null;
  return String(entityType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const withLink = (row) => {
  if (!row) return row;
  const link_url = deriveLink(row);
  return {
    ...row,
    link_url,
    entity_label: row.entity_type ? entityLabel(row.entity_type) : null,
    has_link: Boolean(link_url),
  };
};

/**
 * Resolve when a reminder should fire.
 *
 * An explicit `remind_at` wins — the user picked a moment and we do not
 * second-guess it. Otherwise it is `anchor - reminder_minutes`, so the reminder
 * is expressed RELATIVE to the thing it is about and moves with it. Returning
 * null clears it, which is a real outcome ("no reminder"), not an absence of
 * one.
 *
 * Every branch goes through `toInstant`, so "17:00 with no offset" means the
 * same wall clock here as it does on the task's own due date. Deriving the
 * reminder in a different zone from its anchor would put it an hour out and
 * nothing would report it.
 */
function resolveRemindAt({ remind_at, reminder_minutes, anchor, timeZone }) {
  if (remind_at !== undefined && remind_at !== null) {
    return toInstant(remind_at, { timeZone, dateOnlyTime: "09:00:00" });
  }
  if (reminder_minutes === null || reminder_minutes === undefined) return null;
  if (!anchor) return null;
  const anchorAt = toInstant(anchor, { timeZone, dateOnlyTime: "17:00:00" });
  if (!anchorAt) return null;
  return new Date(new Date(anchorAt).getTime() - reminder_minutes * 60000).toISOString();
}

/* ══════════════════════════════════ TASKS ════════════════════════════════ */

/**
 * May this caller see this specific task?
 *
 * Mirrors the list predicate for the single-record path, because a list filter
 * and a get-by-id that disagree is the classic way a detail view leaks a row
 * the list correctly hid.
 */
function canSeeTask(task, ctx, audience) {
  if (!task) return false;
  const me = ctx.user.user_id;
  if (task.assigned_to === me || task.created_by === me) return true;
  // A personal task belongs to its creator alone, whatever else is true.
  if (task.is_personal && task.created_by !== me) return false;
  if (audience === "mine") return false;
  if (audience === "team") {
    const scopes = ctx.scope_ids || [];
    return !task.scope_id || scopes.includes(task.scope_id);
  }
  return true; // "all"
}

async function listTasks(client, ctx, q = {}) {
  const audience = resolveAudience(ctx, q.audience);
  const { rows, total } = await repo.listTasks(client, {
    ...visibilityOf(ctx, audience),
    status: q.status,
    assignedTo: q.assigned_to === "me" ? ctx.user.user_id : q.assigned_to,
    q: q.q,
    limit: q.limit,
    offset: q.offset,
  });
  return { rows: rows.map(withLink), total, audience, audiences: audiencesFor(ctx) };
}

async function getBoard(client, ctx, q = {}) {
  const audience = resolveAudience(ctx, q.audience);
  const board = await repo.boardTasks(client, {
    ...visibilityOf(ctx, audience),
    assignedTo: q.assigned_to === "me" ? ctx.user.user_id : q.assigned_to,
  });
  for (const k of Object.keys(board)) board[k] = board[k].map(withLink);
  return { board, audience, audiences: audiencesFor(ctx) };
}

async function getTask(client, ctx, id, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const task = await repo.findTask(client, id);
  // Same answer for "missing" and "not yours". Distinguishing them tells a
  // caller which ids exist, which is information they did not ask for.
  if (!task || !canSeeTask(task, ctx, resolved)) {
    throw new AppError("NOT_FOUND", "Task not found", 404);
  }
  const [subtasks, watchers] = await Promise.all([
    repo.listSubtasks(client, id),
    repo.listWatchers(client, id),
  ]);
  return { ...withLink(task), subtasks, watchers };
}

async function createTask(client, ctx, input) {
  const timeZone = await timezoneOf(client);
  // A task due "15/09" is wanted by the end of the working day, not at
  // midnight: 00:00 would make it overdue the moment it is written and sort it
  // above everything else on the day it was created.
  const due_at = toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" });
  const remind_at = resolveRemindAt({
    remind_at: input.remind_at,
    reminder_minutes: input.reminder_minutes,
    anchor: due_at,
    timeZone,
  });
  const task = await repo.insertTask(client, {
    ...input,
    due_at,
    created_by: ctx.user.user_id,
    remind_at,
  });
  if (input.subtasks && input.subtasks.length) {
    for (const [i, s] of input.subtasks.entries()) {
      await repo.insertSubtask(client, {
        task_id: task.task_id,
        title: s.title,
        display_order: s.display_order ?? i + 1,
        // A step's deadline resolves on the tenant clock exactly as the parent's
        // does — a bare date is end of the working day, not midnight.
        due_at: toInstant(s.due_at, { timeZone, dateOnlyTime: "17:00:00" }),
      });
    }
  }
  await emitEvent(client, {
    eventTypeKey: events.TASK_CREATED, moduleKey: events.MODULE,
    entityRef: `task:${task.task_id}`, actorUserId: ctx.user.user_id,
    payload: { status: task.status, priority: task.priority },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_CREATED, moduleKey: events.MODULE,
    entityRef: `task:${task.task_id}`, after: { title: task.title, status: task.status, priority: task.priority },
  });
  const created = await getTask(client, ctx, task.task_id, ctx.audience);
  await notifyAssignee(client, created);
  return created;
}

async function updateTask(client, ctx, id, input) {
  const before = await getTask(client, ctx, id, ctx.audience);
  const timeZone = await timezoneOf(client);
  const patch = { ...input };

  if ("due_at" in input) {
    patch.due_at = toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" });
  }

  // Recompute the reminder when its INPUTS moved and the user did not pin an
  // exact instant. Without this, moving a due date leaves the reminder where
  // it was — an alert for a deadline that is no longer the deadline.
  const anchorChanged = "due_at" in input || "reminder_minutes" in input;
  let rearm = false;
  if (input.remind_at !== undefined) {
    patch.remind_at = toInstant(input.remind_at, { timeZone, dateOnlyTime: "09:00:00" });
    rearm = patch.remind_at !== before.remind_at;
  } else if (anchorChanged) {
    patch.remind_at = resolveRemindAt({
      reminder_minutes: "reminder_minutes" in input ? input.reminder_minutes : before.reminder_minutes,
      anchor: patch.due_at !== undefined ? patch.due_at : before.due_at,
      timeZone,
    });
    rearm = patch.remind_at !== (before.remind_at ? new Date(before.remind_at).toISOString() : null);
  }

  const updated = await repo.updateTask(client, id, patch, { rearm });
  await emitEvent(client, {
    eventTypeKey: events.TASK_UPDATED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, actorUserId: ctx.user.user_id, payload: { fields: Object.keys(input) },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_UPDATED, moduleKey: events.MODULE,
    entityRef: `task:${id}`,
    before: { status: before.status, priority: before.priority, due_at: before.due_at },
    after: { status: updated.status, priority: updated.priority, due_at: updated.due_at },
  });
  const after = await getTask(client, ctx, id, ctx.audience);
  if (input.assigned_to && input.assigned_to !== before.assigned_to) await notifyAssignee(client, after);
  return after;
}

/**
 * Move a task between columns.
 *
 * Its own route rather than a field on PATCH: a status change is the one edit
 * that has consequences beyond the row (completed_at, an event, the assignee's
 * notifications), and giving it a verb keeps that logic in one place instead
 * of scattered across "what changed?" checks.
 */
async function changeStatus(client, ctx, id, status) {
  const before = await getTask(client, ctx, id, ctx.audience);
  if (before.status === status) return before;
  await repo.updateTask(client, id, { status });
  await emitEvent(client, {
    eventTypeKey: events.TASK_STATUS_CHANGED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, actorUserId: ctx.user.user_id,
    payload: { from: before.status, to: status },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_STATUS_CHANGED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, before: { status: before.status }, after: { status },
  });
  return getTask(client, ctx, id);
}

async function deleteTask(client, ctx, id) {
  const before = await getTask(client, ctx, id, ctx.audience);
  await repo.softDeleteTask(client, id);
  await emitEvent(client, {
    eventTypeKey: events.TASK_DELETED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, actorUserId: ctx.user.user_id,
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_DELETED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, before: { title: before.title }, isSensitive: false,
  });
  return { deleted: true };
}

/* ── subtasks ───────────────────────────────────────────────────────────── */

async function addSubtask(client, ctx, taskId, input) {
  await getTask(client, ctx, taskId); // existence + visibility, one check
  const timeZone = await timezoneOf(client);
  const row = await repo.insertSubtask(client, {
    task_id: taskId,
    title: input.title,
    display_order: input.display_order,
    due_at: toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" }),
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_UPDATED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, after: { subtask: row.title },
  });
  return row;
}

/**
 * Patch a step — tick it done, move its deadline, or both.
 *
 * `due_at` resolves on the tenant clock like every other deadline here; only
 * the keys the caller sent are touched, so setting a date does not un-tick a
 * done step and vice versa.
 */
async function patchSubtask(client, ctx, taskId, subtaskId, input) {
  await getTask(client, ctx, taskId);
  const patch = {};
  if ("is_done" in input) patch.is_done = input.is_done;
  if ("due_at" in input) {
    const timeZone = await timezoneOf(client);
    patch.due_at = toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" });
  }
  const row = await repo.updateSubtask(client, subtaskId, patch);
  if (!row || row.task_id !== taskId) throw new AppError("NOT_FOUND", "Subtask not found", 404);
  return row;
}

async function deleteSubtask(client, ctx, taskId, subtaskId) {
  await getTask(client, ctx, taskId);
  const ok = await repo.deleteSubtask(client, subtaskId);
  if (!ok) throw new AppError("NOT_FOUND", "Subtask not found", 404);
  return { deleted: true };
}

/* ── watchers ───────────────────────────────────────────────────────────── */

async function addWatcher(client, ctx, taskId, userId) {
  await getTask(client, ctx, taskId);
  return repo.addWatcher(client, taskId, userId);
}

async function removeWatcher(client, ctx, taskId, userId) {
  await getTask(client, ctx, taskId);
  const ok = await repo.removeWatcher(client, taskId, userId);
  if (!ok) throw new AppError("NOT_FOUND", "Watcher not found", 404);
  return { deleted: true };
}

/* ── notifications ──────────────────────────────────────────────────────── */

/**
 * Tell the assignee they have been given something.
 *
 * NEVER throws, and that is load-bearing rather than defensive: `notify`
 * touches Redis, web-push and possibly SMTP, and a task that fails to SAVE
 * because an alert could not be delivered is a worse outcome than an alert
 * that does not arrive. The task is the record; the notification is a
 * courtesy about it.
 *
 * `link_url` comes from the same derivation the UI uses, so the phone and the
 * screen open the same place.
 */
async function notifyAssignee(client, task) {
  if (!task || !task.assigned_to) return null;
  if (task.assigned_to === task.created_by) return null; // assigning it to yourself is not news
  try {
    const { notify } = require("../../notification/notification.service");
    return await notify(client, {
      userId: task.assigned_to,
      eventTypeKey: events.TASK_ASSIGNED,
      title: "A task was assigned to you",
      body: task.title,
      entityRef: `task:${task.task_id}`,
      priority: task.priority === "URGENT" ? "HIGH" : "NORMAL",
      url: task.link_url,
      dedupeKey: `task-assigned:${task.task_id}:${task.assigned_to}`,
    });
  } catch (err) {
    logger.error({ err, task_id: task.task_id }, "task assignment notification failed");
    return null;
  }
}

/* ════════════════════════════ CALENDAR EVENTS ═══════════════════════════ */

/**
 * Events in a window.
 *
 * `mine` is the default and it is not the same question as the task audience:
 * an event is an appointment in a diary, and "show me the team's diary" is a
 * different product (a shared resource calendar) that nobody has asked for.
 * `audience=all` is honoured only for a caller whose grants make them
 * tenant-wide, and even then it means "everything", not "my team's" — because
 * `calendar_event` carries no scope_id to narrow by, and inventing a team
 * filter on a table that cannot express it would silently return the wrong set.
 */
async function listEvents(client, ctx, q = {}) {
  const seeAll = q.audience === "all" && ctx.permission_scope === "all";
  const rows = await repo.listEvents(client, {
    from: q.from, to: q.to, eventType: q.event_type,
    userId: ctx.user.user_id, mine: !seeAll,
  });
  return rows.map(withLink);
}

async function getEvent(client, ctx, id) {
  const event = await repo.findEvent(client, id);
  if (!event) throw new AppError("NOT_FOUND", "Event not found", 404);
  const participants = await repo.listParticipants(client, id);
  return { ...withLink(event), participants };
}

async function createEvent(client, ctx, input) {
  // Clash detection is advisory and OPT-OUT (`force`), not a hard block: two
  // things genuinely can happen in one room, and a calendar that refuses is a
  // calendar people work around by not booking rooms.
  if (input.location && !input.force) {
    const clashes = await repo.findEventClashes(client, {
      location: input.location, start_at: input.start_at, end_at: input.end_at,
    });
    if (clashes.length) {
      throw new AppError(
        "CLASH_DETECTED",
        `${clashes.length} event${clashes.length > 1 ? "s are" : " is"} already booked at ${input.location} during this time. Save again to book it anyway.`,
        409,
        { clashes },
      );
    }
  }
  const timeZone = await timezoneOf(client);
  // An event ON a bare date starts at midnight — that is what "all day" means,
  // and it is deliberately not the 17:00 a bare DUE date gets.
  const start_at = toInstant(input.start_at, { timeZone, dateOnlyTime: "00:00:00" });
  const end_at = toInstant(input.end_at, { timeZone, dateOnlyTime: "23:59:00" });
  if (start_at && end_at && end_at < start_at) {
    throw new AppError("INVALID_VALUE", "The event must end after it starts", 422, { end_at: ["must be at or after the start"] });
  }
  const remind_at = resolveRemindAt({
    remind_at: input.remind_at,
    reminder_minutes: input.reminder_minutes,
    anchor: start_at,
    timeZone,
  });
  const event = await repo.insertEvent(client, {
    ...input, start_at, end_at, created_by: ctx.user.user_id, remind_at,
  });
  for (const p of input.participants || []) {
    await repo.insertParticipant(client, { calendar_event_id: event.calendar_event_id, ...p });
  }
  await emitEvent(client, {
    eventTypeKey: events.EVENT_CREATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${event.calendar_event_id}`, actorUserId: ctx.user.user_id,
  });
  await audit(client, {
    ...actorOf(ctx), action: events.EVENT_CREATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${event.calendar_event_id}`,
    after: { title: event.title, start_at: event.start_at, end_at: event.end_at },
  });
  return getEvent(client, ctx, event.calendar_event_id);
}

async function updateEvent(client, ctx, id, input) {
  const before = await getEvent(client, ctx, id);
  const timeZone = await timezoneOf(client);
  const patch = { ...input };
  if ("start_at" in input) patch.start_at = toInstant(input.start_at, { timeZone, dateOnlyTime: "00:00:00" });
  if ("end_at" in input) patch.end_at = toInstant(input.end_at, { timeZone, dateOnlyTime: "23:59:00" });

  let rearm = false;
  if (input.remind_at !== undefined) {
    patch.remind_at = toInstant(input.remind_at, { timeZone, dateOnlyTime: "09:00:00" });
    rearm = true;
  } else if ("start_at" in input || "reminder_minutes" in input) {
    patch.remind_at = resolveRemindAt({
      reminder_minutes: "reminder_minutes" in input ? input.reminder_minutes : before.reminder_minutes,
      anchor: patch.start_at !== undefined ? patch.start_at : before.start_at,
      timeZone,
    });
    rearm = true;
  }
  await repo.updateEvent(client, id, patch, { rearm });
  await emitEvent(client, {
    eventTypeKey: events.EVENT_UPDATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`, actorUserId: ctx.user.user_id, payload: { fields: Object.keys(input) },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.EVENT_UPDATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`,
    before: { start_at: before.start_at, end_at: before.end_at },
    after: { start_at: patch.start_at ?? before.start_at, end_at: patch.end_at ?? before.end_at },
  });
  return getEvent(client, ctx, id);
}

async function deleteEvent(client, ctx, id) {
  const before = await getEvent(client, ctx, id);
  await repo.softDeleteEvent(client, id);
  await emitEvent(client, {
    eventTypeKey: events.EVENT_DELETED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`, actorUserId: ctx.user.user_id,
  });
  await audit(client, {
    ...actorOf(ctx), action: events.EVENT_DELETED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`, before: { title: before.title },
  });
  return { deleted: true };
}

/* ── participants ───────────────────────────────────────────────────────── */

async function addParticipant(client, ctx, eventId, input) {
  await getEvent(client, ctx, eventId);
  const row = await repo.insertParticipant(client, { calendar_event_id: eventId, ...input });
  if (!row) throw new AppError("ALREADY_EXISTS", "That person is already on this event", 409);
  return row;
}

async function respondParticipant(client, ctx, eventId, participantId, status) {
  await getEvent(client, ctx, eventId);
  const row = await repo.respondParticipant(client, participantId, status);
  if (!row || row.calendar_event_id !== eventId) throw new AppError("NOT_FOUND", "Participant not found", 404);
  return row;
}

async function removeParticipant(client, ctx, eventId, participantId) {
  await getEvent(client, ctx, eventId);
  const ok = await repo.removeParticipant(client, participantId);
  if (!ok) throw new AppError("NOT_FOUND", "Participant not found", 404);
  return { deleted: true };
}

/* ══════════════════════════════ THE MERGED DAY ═══════════════════════════ */

/**
 * Tasks and events for one window, interleaved by WHEN.
 *
 * This is the surface the "Today" tab renders, and the merge is the feature:
 * a fitting at 10:00 and a task due at 17:00 are the same kind of thing to the
 * person living the day — something that will want them at a time. Two panels
 * side by side would make them read the calendar, then read the list, and hold
 * both in their head. One list, in time order, does not ask that of them.
 *
 * The merge happens HERE rather than in SQL because the two rows have different
 * shapes and the ordering key differs (a due date is a deadline, a start is an
 * appointment) — expressing that as a UNION would mean casting both into a
 * lowest-common-denominator row and throwing the detail away.
 */
/**
 * Interleave tasks and events by WHEN. Pure — no client, no caller — because
 * the ordering IS the feature and it should be checkable without a database.
 *
 * The merge happens here rather than in SQL because the two rows have different
 * shapes and the ordering key differs (a due date is a deadline, a start is an
 * appointment); a UNION would mean casting both into a lowest-common-denominator
 * row and throwing the detail away.
 */
function mergeTimeline(tasks, eventsRows) {
  const items = [
    ...(tasks || []).map((t) => ({
      kind: "task", at: t.due_at, id: t.task_id, title: t.title,
      status: t.status, priority: t.priority, link_url: deriveLink(t),
      entity_type: t.entity_type, entity_id: t.entity_id,
      assigned_to_name: t.assigned_to_name, subtask_count: t.subtask_count,
      subtask_done_count: t.subtask_done_count,
      is_overdue: t.status !== "DONE" && t.status !== "CANCELLED"
        && Boolean(t.due_at) && new Date(t.due_at) < new Date(),
    })),
    ...(eventsRows || []).map((e) => ({
      kind: "event", at: e.start_at, id: e.calendar_event_id,
      title: e.title, event_type: e.event_type, location: e.location,
      all_day: e.all_day, end_at: e.end_at, link_url: deriveLink(e),
      entity_type: e.entity_type, entity_id: e.entity_id,
      participant_count: e.participant_count,
    })),
  ];

  // Undated work sorts last rather than first: a task with no due date is not
  // the most urgent thing on the list, it is the thing with no claim on today.
  items.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    const d = new Date(a.at) - new Date(b.at);
    if (d !== 0) return d;
    // Same instant: the appointment first. A meeting has a room and other
    // people in it; a task can slip ten minutes and nobody is kept waiting.
    return a.kind === "event" ? -1 : 1;
  });
  return items;
}

/**
 * Tasks and events for one window, interleaved by time.
 *
 * This is the surface the "Today" tab renders, and the merge is the feature: a
 * fitting at 10:00 and a task due at 17:00 are the same kind of thing to the
 * person living the day — something that will want them at a time. Two panels
 * side by side would make them read the calendar, then read the list, and hold
 * both in their head. One list, in time order, does not ask that of them.
 */
async function dayTimeline(client, ctx, { from, to, audience }) {
  const resolved = resolveAudience(ctx, audience);
  const vis = visibilityOf(ctx, resolved);
  const [tasks, eventsRows] = await Promise.all([
    repo.tasksInRange(client, { from, to, visibility: vis }),
    repo.listEvents(client, { from, to, mine: true, userId: ctx.user.user_id }),
  ]);
  const items = mergeTimeline(tasks, eventsRows);
  return { items, audience: resolved, audiences: audiencesFor(ctx), tasks: tasks.length, events: eventsRows.length };
}

/**
 * Every deadline in a window — task due dates AND subtask due dates — for the
 * calendar's overlay.
 *
 * This is the "deadlines appear on the calendar" surface: the month grid draws
 * events from `/workspace/events` and lays these on top as due-date chips. Kept
 * SEPARATE from `listEvents` because a deadline is not an appointment — it has
 * no duration, it opens the task rather than an event dialog, and folding it
 * into the events list would make it editable as one. Both halves go through the
 * same `visibilityOf`, so a deadline chip can never show for a task the caller
 * could not open.
 */
async function deadlinesInRange(client, ctx, { from, to, audience }) {
  const resolved = resolveAudience(ctx, audience);
  const vis = visibilityOf(ctx, resolved);
  const [tasks, subtasks] = await Promise.all([
    repo.tasksInRange(client, { from, to, visibility: vis }),
    repo.subtasksInRange(client, { from, to, visibility: vis }),
  ]);
  const now = Date.now();
  const items = [
    ...tasks
      .filter((t) => t.status !== "CANCELLED")
      .map((t) => ({
        kind: "task", task_id: t.task_id, subtask_id: null,
        title: t.title, task_title: null, at: t.due_at,
        status: t.status, priority: t.priority, is_done: t.status === "DONE",
        is_overdue: t.status !== "DONE" && Boolean(t.due_at) && new Date(t.due_at).getTime() < now,
      })),
    ...subtasks
      .filter((s) => s.task_status !== "CANCELLED")
      .map((s) => ({
        kind: "subtask", task_id: s.task_id, subtask_id: s.task_subtask_id,
        title: s.title, task_title: s.task_title, at: s.due_at,
        status: s.task_status, priority: s.task_priority, is_done: s.is_done,
        is_overdue: !s.is_done && Boolean(s.due_at) && new Date(s.due_at).getTime() < now,
      })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { items, audience: resolved, audiences: audiencesFor(ctx) };
}

module.exports = {
  VALID_STATUSES, DONE_STATUSES,
  audiencesFor, resolveAudience, visibilityOf, resolveRemindAt, withLink, deriveLink, canSeeTask,
  listTasks, getBoard, getTask, createTask, updateTask, changeStatus, deleteTask,
  addSubtask, patchSubtask, deleteSubtask, addWatcher, removeWatcher, notifyAssignee,
  listEvents, getEvent, createEvent, updateEvent, deleteEvent,
  addParticipant, respondParticipant, removeParticipant,
  mergeTimeline, dayTimeline, deadlinesInRange,
};
