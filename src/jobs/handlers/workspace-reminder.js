/**
 * Worker job: fire the workspace reminders whose time has come (13810), now
 * with the several-reminders, author-override and per-recipient dedupe of
 * PR 3 (13890).
 *
 * ── THE TABLE IS THE QUEUE ─────────────────────────────────────────────────
 *
 * There is no scheduled-job registry, no in-memory timer and nothing to
 * reconstruct after a restart. A reminder is a ROW of `workspace_reminder`
 * (`remind_at` = when, `reminder_sent_at` = whether), not a column of its
 * owner, and this job is a scan:
 *
 *     WHERE remind_at <= now() AND reminder_sent_at IS NULL
 *
 * That is the whole mechanism, and the properties fall out of it rather than
 * being engineered: a restart loses nothing because nothing was held; two
 * workers racing cannot double-fire because the row stops matching the
 * predicate the moment it is stamped; and moving a due date RE-ARMS the
 * reminders of the task it moved.
 *
 * ── WHY A FAILED DELIVERY STILL STAMPS THE ROW ─────────────────────────────
 *
 * `markReminderSent` runs even when `notify` threw. The alternative — leave
 * the row armed so it retries next minute — means one undeliverable row is
 * re-selected forever, and since the sweep takes the oldest 200 rows first,
 * a handful of poison rows permanently occupy the batch and NO reminder in
 * the tenant ever fires again. That failure is silent, total and
 * tenant-wide. Losing one notification is recoverable: the task is still on
 * the person's desk, still showing its due date. A wedged queue is not.
 *
 * ── WHY THE DEDUPE KEY CARRIES THE RECIPIENT ───────────────────────────────
 *
 * A row carries ONE reminder for ONE owner, and the dedupeKey is the row's
 * own identity (`task-reminder:<reminder-id>:<user-id>`). A shared per-record
 * key applied across recipients — the 13810 handler's
 * `event-reminder:<event-id>` — claimed the dedupe with the first recipient
 * and silently suppressed every later recipient the same row had to reach.
 * That was the actual bug: invited participants were never told, because the
 * organiser's notify claimed the key first. The row's id stamps the claim so
 * a retried job does not double-send, and the recipient's id distinguishes
 * fan-out from re-attempt.
 *
 * ── THE AUTHOR'S EMAIL OVERRIDE ────────────────────────────────────────────
 *
 * A row with `email: true` asks for email on top of the recipient's ordinary
 * preference, and `forceEmail` is how the sweep says so to notify() — one
 * named author, one named deadline, one reminder row. The row's own `email`
 * flag is the only place the choice lives, so the sweep doesn't invent the
 * policy per tick: it reads the row, passes the truth forward, and the
 * notification service spends the preference's carve-outs (security,
 * silence routing) on top.
 *
 * `notify` writes to `event_log` through its own path, so a tenant watching
 * for reminders still sees them; this file does not emit separately, because
 * a second event for one reminder is two rows saying the same thing.
 *
 * Job data: { tenantMeta, env, limit? }.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const repo = require("../../modules/dashboard/workspace/tasks.repo");
const events = require("../../modules/dashboard/workspace/workspace.events");
const service = require("../../modules/dashboard/workspace/tasks.service");
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
          // Per-reminder AND per-recipient: a retried job does not re-tell
          // this person about this reminder, and a sibling reminder on the
          // same task still reaches them.
          dedupeKey: `task-reminder:${row.workspace_reminder_id}:${recipient}`,
          forceEmail: row.email === true,
        });
        // Counted only when something was actually sent. Counting the ROW
        // instead made the log line claim a reminder nobody received, which is
        // the one number an operator would use to decide the sweep is healthy.
        tasks += 1;
      }
    } catch (err) {
      failures += 1;
      logger.error({ err, task_id: row.task_id, workspace_reminder_id: row.workspace_reminder_id }, "task reminder delivery failed — row will still be disarmed");
    }
    // Unconditional. See the header: this is what keeps one bad row from
    // occupying the batch forever.
    await repo.markReminderSent(client, row.workspace_reminder_id, nowIso);
  }

  for (const row of await repo.dueEventReminders(client, nowIso, limit)) {
    // The organiser plus everybody invited. A Set, because the organiser is
    // usually also a participant and should not be told twice — but the
    // dedupe per recipient is the load-bearing guard, since the same user
    // could arrive by ownership OR by invitation on two rows of one sweep.
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
          dedupeKey: `event-reminder:${row.workspace_reminder_id}:${userId}`,
          forceEmail: row.email === true,
        });
        eventsFired += 1;
      } catch (err) {
        failures += 1;
        logger.error({ err, calendar_event_id: row.calendar_event_id, workspace_reminder_id: row.workspace_reminder_id }, "event reminder delivery failed — row will still be disarmed");
      }
    }
    await repo.markReminderSent(client, row.workspace_reminder_id, nowIso);
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
    const reminders = await sweep(c, { notify, timeZone, limit });
    // The spawn half rides beside the reminder sweep, after it: reminders fire
    // for the occurrence that is here, then the series materialises its next one
    // (13840). One connection, one tick, both halves of "recurring".
    const spawned = await service.spawnDue(c, { limit });
    return { ...reminders, spawnedTasks: spawned.tasks, spawnedEvents: spawned.events };
  });
  if (out.tasks || out.events || out.failures || out.spawnedTasks || out.spawnedEvents) {
    logger.info({ tenant: tenantMeta.slug, env, ...out }, "[workspace] reminders swept, occurrences spawned");
  }
  return out;
};

module.exports.sweep = sweep;
module.exports.fmtWhen = fmtWhen;
module.exports.BATCH = BATCH;
