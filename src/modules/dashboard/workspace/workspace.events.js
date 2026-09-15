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

  EVENT_CREATED: "calendar_event.created",
  EVENT_UPDATED: "calendar_event.updated",
  EVENT_DELETED: "calendar_event.deleted",
  EVENT_REMINDER_DUE: "calendar_event.reminder_due",
};
