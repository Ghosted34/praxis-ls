/**
 * Worker job: drain a tenant's orchestration outbox (Plan A). Job data:
 * { tenantMeta, env, limit? }. Scheduled per-tenant like regie-aging (a recurring
 * fan-out enqueues it; low-latency triggering after a business op is a follow-up).
 * Runs on the tenant connection so event_log / event_dispatch resolve to the
 * caller's schema (live vs sandbox).
 *
 * Also runs the dead-letter census on every sweep — see OBS-A6 below.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { dispatchPending, countDeadLetters } = require("../../orchestration/dispatcher");
const { logger } = require("../../config/logger");
const { report } = require("../../shared/observability/error-reporter");

/**
 * How long a standing dead-letter backlog may sit before it is re-raised.
 *
 * The reporter dedupes on the error, so a backlog of the SAME failure notifies
 * once and then goes quiet — correct for noise, wrong for something nobody has
 * actioned. This re-raises a standing backlog daily so it cannot be quietly
 * forgotten, without turning every sweep into a page.
 */
const DEAD_LETTER_RENOTIFY_MS = 24 * 60 * 60 * 1000;

/** `${slug}:${env}` -> timestamp of the last dead-letter notification. */
const lastNotified = new Map();

module.exports = async function orchestrationDispatch(job) {
  const { tenantMeta, env = "live", limit } = job.data || {};
  if (!tenantMeta) throw new Error("orchestration-dispatch job needs tenantMeta");

  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const result = await dispatchPending(c, { limit });

    // OBS-A6 (Critical): "Nothing ever queries event_dispatch WHERE
    // status='DEAD'." Something does now, on every sweep.
    //
    // The events that die here are the cross-module money flows — an approved
    // costing that should raise a draft invoice, a supplier invoice that should
    // create a cost entry, a receipt that should signal collection. When one
    // gives up, the app carries on returning 200s and simply never does the
    // thing it was asked to do. Nobody finds out until a human notices a
    // missing invoice, possibly weeks later.
    //
    // Deliberately does NOT throw. A dead-letter backlog is a business problem
    // to action, not a reason to fail the sweep and stop draining the events
    // that still work.
    try {
      const dl = await countDeadLetters(c);
      result.dead_letters = dl.total;

      if (dl.total > 0) {
        const key = `${tenantMeta.slug}:${env}`;
        const now = Date.now();
        const due = now - (lastNotified.get(key) || 0) > DEAD_LETTER_RENOTIFY_MS;

        logger.error(
          { tenant: tenantMeta.slug, env, dead_letters: dl.total, by_type: dl.byType },
          "[orchestration] dead-lettered business events are sitting unprocessed",
        );

        // Notify when something newly died this sweep, and again daily while a
        // backlog stands. The message text is stable so the daily re-raise
        // stays one thread rather than a new alert each day.
        if (result.dead > 0 || due) {
          lastNotified.set(key, now);
          report(
            new Error(
              `dead_letter_backlog: business events permanently undelivered for ${tenantMeta.slug}/${env}`,
            ),
            {
              origin: "worker",
              severity: "fatal",
              route: "orchestration/dead-letters",
              tenant: tenantMeta.slug,
              extra: { env, total: dl.total, by_type: dl.byType },
            },
          );
        }
      } else {
        lastNotified.delete(`${tenantMeta.slug}:${env}`);
      }
    } catch (err) {
      // The census failing must not fail the drain.
      logger.error(
        { err, tenant: tenantMeta.slug, env },
        "[orchestration] dead-letter census failed",
      );
    }

    return result;
  });
};

module.exports.DEAD_LETTER_RENOTIFY_MS = DEAD_LETTER_RENOTIFY_MS;
/** Test seam. */
module.exports.__resetDeadLetterNotifications = () => lastNotified.clear();
