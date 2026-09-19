"use strict";
/**
 * My Workspace — tasks and calendar events (MOD-00A).
 *
 * Keys are dotted `noun.verb` like every other entry in the event_type
 * catalogue (see migrations/seeds/9020_seed_rbac_events.sql), and every one of
 * them has a matching row in migrations/tenant/13820 so `emitEvent` can
 * resolve it.
 *
 * `task.reminder_due` and `calendar_event.reminder_due` are emitted by the
 * reminder sweep. They exist so a tenant can hang a workflow on "a reminder
 * fired" without the sweep having to know about it — but note they are
 * emitted AFTER the row is stamped, so a failure here cannot re-fire a
 * reminder or wedge the queue.
 */
module.exports = {
  MODULE: "MOD-00A",

  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_STATUS_CHANGED: "task.status_changed",
  TASK_ASSIGNED: "task.assigned",
  TASK_DELETED: "task.deleted",
  TASK_REMINDER_DUE: "task.reminder_due",

  // PR 2 (13870). Hierarchy needs no key of its own — a child task IS a task
  // and emits `task.created` — but an edge, a watcher and a ping are actions
  // on a task that no existing key describes.
  TASK_DEPENDENCY_ADDED: "task.dependency_added",
  TASK_DEPENDENCY_REMOVED: "task.dependency_removed",
  TASK_DEPENDENCY_OVERRIDDEN: "task.dependency_overridden",
  TASK_WATCHER_ADDED: "task.watcher_added",
  TASK_WATCHER_REMOVED: "task.watcher_removed",
  TASK_PINGED: "task.pinged",

  // 13975 — a blockage is an external hold ("customs' network is down"), not a
  // dependency edge: nothing in the task graph represents it, so it gets its
  // own rows and its own two keys. Raised is the loud one (forced notification
  // + SmartComm fan-out); resolved is the quiet one that also explains a
  // due-date shift.
  TASK_BLOCKAGE_RAISED: "task.blockage_raised",
  TASK_BLOCKAGE_RESOLVED: "task.blockage_resolved",

  EVENT_CREATED: "calendar_event.created",
  EVENT_UPDATED: "calendar_event.updated",
  EVENT_DELETED: "calendar_event.deleted",
  EVENT_REMINDER_DUE: "calendar_event.reminder_due",
  // PR 3 (13890) — an invitation is a message to a named person, and a
  // response is news the organiser asked for; both are their own keys rather
  // than folded into calendar_event.updated, because workflow hooks on "the
  // invite went out" should not fire for every title edit.
  EVENT_PARTICIPANT_INVITED: "calendar_event.participant_invited",
  EVENT_PARTICIPANT_RESPONDED: "calendar_event.participant_responded",
};
