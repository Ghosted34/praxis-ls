/**
 * Worker job: tell a client what is waiting in their portal (14180).
 *
 * Queued by `shared/notifications/notify-portal.js` when a reply, a request, an
 * invoice, a proposal or a shipment stage is recorded for a client; one job per
 * client, topic (and conversation), stage and time window, so a burst of
 * events is one job and one message. The job name is the stage: `push` and
 * `email` for a chat reply (pushed within seconds, emailed only if still
 * unread ten minutes later), `both` for everything else.
 *
 * LIVE ONLY. A sandbox has no real clients, and must never reach one.
 *
 * After its own batch it re-queues any group another job left waiting — a
 * queue that was down when the event happened, or a job lost to a restart —
 * so a notification is late rather than never.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const portalNotify = require("../../modules/portal/portal_notify.service");
const { schedule } = require("../../shared/notifications/notify-portal");
const { logger } = require("../../config/logger");

module.exports = async function portalNotifyDeliver(job) {
  const { tenantMeta, env = "live", clientId, topic, thread = null, stage } = job.data || {};
  if (!tenantMeta) throw new Error("portal-notify-deliver job needs tenantMeta");
  if (!clientId || !topic || !["push", "email", "both"].includes(stage)) {
    throw new Error("portal-notify-deliver job needs a client, a topic and a stage");
  }
  if (env !== "live") return { skipped: "sandbox" };

  const out = await registry.withTenantConnection(tenantMeta, "live", (c) =>
    portalNotify.deliver(c, { tenant: tenantMeta, clientId, topic, thread, stage }));

  for (const group of out.stale || []) {
    await schedule(tenantMeta, group).catch((err) =>
      logger.warn({ err, group }, "[portal-notify] could not re-queue a waiting group"));
  }
  return { pushed: out.pushed, emailed: out.emailed, people: out.people, requeued: (out.stale || []).length };
};
