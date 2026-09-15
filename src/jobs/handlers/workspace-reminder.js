/**
 * Worker job: fire the workspace reminders whose time has come (13810).
 *
 * ── THE TABLE IS THE QUEUE ─────────────────────────────────────────────────
 *
 * There is no scheduled-job registry, no in-memory timer and nothing to
 * reconstruct after a restart. A reminder is a pair of columns — `remind_at`
 * (when) and `reminder_sent_at` (whether) — and this job is a scan:
 *
 *     WHERE remind_at <= now() AND reminder_sent_at IS NULL
 *
 * That is the whole mechanism, and the properties fall out of it rather than
 * being engineered: a restart loses nothing because nothing was held; two
 * workers racing cannot double-fire because the row stops matching the
 * predicate the moment it is stamped; and moving a due date RE-ARMS the
 * reminder with a single UPDATE that clears the stamp.
 *
 * ── WHY A FAILED DELIVERY STILL STAMPS THE ROW ─────────────────────────────
 *
 * `markReminderSent` runs even when `notify` threw. That is deliberate and it
 * is the single most important line in this file. The alternative — leave the
 * row armed so it retries next minute — means one undeliverable reminder is
 * re-selected forever, and since the sweep takes the oldest 200 rows first, a
 * handful of poison rows permanently occupy the batch and NO reminder in the
 * tenant ever fires again. That failure is silent, total and tenant-wide.
 *
 * Losing one notification is recoverable: the task is still on the person's
 * desk, still showing its due date. A wedged queue is not.
 *
 * ── WHY IT NOTIFIES RATHER THAN EMITTING ───────────────────────────────────
 *
 * Unlike contract-lapse, which emits an event for a tenant's watchers to pick
 * up, a reminder has a specific, known audience: the person the task is
 * assigned to, or the people in the meeting. `notify` reaches exactly them,
 * through the channel each of them chose, and respects their per-category
 * preferences. Emitting instead would make "your task is due" a broadcast
 * whose audience is whoever happens to watch MOD-00A.
 *
 * `notify` writes to `event_log` through its own path, so a tenant watching for
 * reminders still sees them; this file does not emit separately, because a
 * second event for one reminder is two rows saying the same thing.
 *
 * Job data: { tenantMeta, env, limit? }.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const repo = require("../../modules/dashboard/workspace/tasks.repo");
const events = require("../../modules/dashboard/workspace/workspace.events");
const { entityRoute } = require("@praxis/shared");
const { logger } = require("../../config/logger");

/** Rows per table per tick. Bounded so a tenant that has been offline for a
 *  month comes back with a trickle rather than ten thousand push notifications
 *  in one second — the rest arrive on the following ticks. */
const BATCH = 200;

/**
 * When a reminder is about, in the reader's own idiom.
 *
 * `en-GB` and an explicit zone, never a bare `toLocaleDateString()`: the
 * worker container has no `LANG`, and a formatter with no locale means
 * "whatever this machine is set to", which is month-first on a US host and
 * undefined in a bare container. The date gate in CI checks the frontend for
 * exactly this; a worker is the same reader with worse diagnostics.
 */
function fmtWhen(value, timeZone) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }).format(d);
}

/** The screen the reminder should open, or null when there is nowhere to go. */
function linkFor(entityType, entityId) {
  if (!entityType || !entityId) return null;
  try {
    return entityRoute.urlFor(`${entityType}:${entityId}`);
  } catch {
    return null;
  }
}

/**
 * Sweep one tenant. Exported so it can be tested with an injected notifier —
 * the real one touches Redis, web-push and possibly SMTP, and a test that has
 * to stand all of those up is a test nobody runs.
 */
async function sweep(client, { notify, timeZone, now = new Date(), limit = BATCH } = {}) {
  const nowIso = now.toISOString();
  let tasks = 0;
  let eventsFired = 0;
  let failures = 0;

  for (const row of await repo.dueTaskReminders(client, nowIso, limit)) {
    // Assigned to somebody: tell them. Written down for yourself: tell you.
    // Nobody to tell is a real state (an unassigned, unowned task) and the
    // row is still stamped below, so it does not come back every minute.
    const recipient = row.assigned_to || row.created_by;
    const when = fmtWhen(row.due_at, timeZone);
    try {
      if (recipient) {
        await notify(client, {
          userId: recipient,
          eventTypeKey: events.TASK_REMINDER_DUE,
          title: "Task reminder",
          body: when ? `“${row.title}” is due ${when}.` : `Reminder: “${row.title}”.`,
          entityRef: `task:${row.task_id}`,
          priority: row.priority === "URGENT" ? "HIGH" : "NORMAL",
          url: linkFor(row.entity_type, row.entity_id),
          dedupeKey: `task-reminder:${row.task_id}`,
        });
        // Counted only when something was actually sent. Counting the ROW
        // instead made the log line claim a reminder nobody received, which is
        // the one number an operator would use to decide the sweep is healthy.
        tasks += 1;
      }
    } catch (err) {
      failures += 1;
      logger.error({ err, task_id: row.task_id }, "task reminder delivery failed — row will still be disarmed");
    }
    // Unconditional. See the header: this is what keeps one bad row from
    // occupying the batch forever.
    await repo.markTaskReminderSent(client, row.task_id, nowIso);
  }

  for (const row of await repo.dueEventReminders(client, nowIso, limit)) {
    // The organiser plus everybody invited. A Set, because the organiser is
    // usually also a participant and should not be told twice.
    const recipients = new Set([row.created_by, ...(row.participant_user_ids || [])].filter(Boolean));
    const when = fmtWhen(row.start_at, timeZone);
    const where = row.location ? ` · ${row.location}` : "";
    for (const userId of recipients) {
      try {
        await notify(client, {
          userId,
          eventTypeKey: events.EVENT_REMINDER_DUE,
          title: "Coming up",
          body: when ? `“${row.title}” starts ${when}${where}.` : `Reminder: “${row.title}”.`,
          entityRef: `calendar_event:${row.calendar_event_id}`,
          priority: "NORMAL",
          url: linkFor(row.entity_type, row.entity_id),
          dedupeKey: `event-reminder:${row.calendar_event_id}`,
        });
        eventsFired += 1;
      } catch (err) {
        failures += 1;
        logger.error({ err, calendar_event_id: row.calendar_event_id }, "event reminder delivery failed — row will still be disarmed");
      }
    }
    await repo.markEventReminderSent(client, row.calendar_event_id, nowIso);
  }

  return { tasks, events: eventsFired, failures };
}

module.exports = async function workspaceReminderSweep(job) {
  const { tenantMeta, env = "live", limit = BATCH } = job.data || {};
  if (!tenantMeta) throw new Error("workspace-reminder job needs tenantMeta");
  const { timezoneOf } = require("../../modules/dashboard/workspace/workspace.time");
  const out = await registry.withTenantConnection(tenantMeta, env, async (c) => {
    const { notify } = require("../../modules/notification/notification.service");
    const timeZone = await timezoneOf(c);
    return sweep(c, { notify, timeZone, limit });
  });
  if (out.tasks || out.events || out.failures) {
    logger.info({ tenant: tenantMeta.slug, env, ...out }, "[workspace] reminders swept");
  }
  return out;
};

module.exports.sweep = sweep;
module.exports.fmtWhen = fmtWhen;
module.exports.BATCH = BATCH;
