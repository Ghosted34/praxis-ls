/**
 * Worker job: the OUTBOUND half of a notification — web-push to every
 * registered device, and email where it is wanted or where push reached
 * nothing.
 *
 * ── WHY THIS JOB EXISTS ─────────────────────────────────────────────────────
 *
 * Both sends used to happen inline in `notification.service`, on the producer's
 * connection, WHILE ITS WRITE TRANSACTION WAS STILL OPEN. Two consequences, and
 * the second is the one that loses mail:
 *
 *   1. An SMTP conversation and one HTTPS request per device sat inside a
 *      transaction that held locks on the business row and pinned one of eight
 *      pooled connections for their duration.
 *
 *   2. There was no retry. A push service answering 500 — which they do, they
 *      are ordinary web services — meant the notification was logged at warn
 *      level and lost for ever, with the user none the wiser.
 *
 * Here it gets BullMQ's attempts and exponential backoff. A push that fails
 * because FCM was briefly unhappy is retried until it lands.
 *
 * ── WHY THE JOB CARRIES A PLAN AND NOT A REQUEST ────────────────────────────
 *
 * `recipients` arrives already resolved — who, whether they want email, and the
 * badge number each should see — because those were decided against the same
 * transaction that wrote the in-app rows. Re-deriving them here would read a
 * database that has moved on, and a retry three minutes later would then not
 * necessarily agree with the notification the user is already looking at
 * in-app.
 *
 * ── ON RETRIES AND DUPLICATES ───────────────────────────────────────────────
 *
 * The unit of retry is the whole plan, so a job where two of three recipients
 * were pushed and the third threw will, on retry, push all three again — the
 * two get a duplicate. That is deliberate: for the categories this path is
 * built for, a notification arriving twice is a nuisance and a notification
 * arriving never is the failure the whole change exists to remove. The push
 * `tag` (mail collapses per thread) means the duplicate usually replaces the
 * first rather than stacking, so in practice the user sees one.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const notifications = require("../../modules/notification/notification.service");

module.exports = async function notificationDeliver(job) {
  const { tenantMeta, env = "live", recipients, notification } = job.data || {};
  if (!tenantMeta) throw new Error("notification-deliver job needs tenantMeta");
  if (!recipients || !recipients.length) return { pushed: 0, emailed: 0, recipients: 0 };
  if (!notification || !notification.title) throw new Error("notification-deliver job needs a notification with a title");

  return registry.withTenantConnection(tenantMeta, env, (c) =>
    notifications.deliverOutbound(c, { recipients, notification }));
};
