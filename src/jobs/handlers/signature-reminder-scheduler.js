/**
 * Worker job: signature-reminder fan-out. One `signature-reminder` job per live
 * tenant, hourly.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §6.8.
 *
 * ── WHY HOURLY ─────────────────────────────────────────────────────────────
 * The rule is "a party who has had their link for two days gets a nudge, and
 * again at five". A DAILY tick would make "two days" mean "somewhere between
 * two and three days, depending when the fleet cron fires" — and the second
 * nudge would drift further. Hourly bounds the lateness at an hour and costs
 * one indexed range scan per tenant per hour, which returns nothing almost
 * every time.
 *
 * ── WHY LIVE ONLY ──────────────────────────────────────────────────────────
 * Reminders EMAIL a counterparty. `email.service`'s sandbox guard already
 * suppresses the send, so a Test sweep would advance `reminder_count` and
 * suppress the mail — burning one of the two nudges a request gets, on a
 * rehearsal. Same line `scheduled-report-scheduler` and
 * `regie-aging-scheduler` draw.
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * `recordReminder` advances `reminder_count` under a `WHERE reminder_count < 2`,
 * so a second tick in the same hour re-selects nothing and a race cannot
 * produce a third email. The per-tenant `jobId` additionally dedupes an
 * in-flight sweep.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

/** `YYYY-MM-DDTHH` — the tick's own hour, for the dedupe key. */
const hourStamp = () => new Date().toISOString().slice(0, 13);

module.exports = async function signatureReminderScheduler() {
  const tenants = await registry.listActiveTenants();
  const stamp = hourStamp();
  let enqueued = 0;
  let skipped = 0;

  for (const meta of tenants) {
    try {
      // eslint-disable-next-line no-await-in-loop -- the fan-out is deliberately
      // serial so one slow enqueue cannot flood the queue for the rest.
      await enqueue(
        "signature-reminder",
        "sweep",
        { tenantMeta: meta, env: "live" },
        {
          // `live-<hour>` rather than `live:<hour>`: a BullMQ custom job id may
          // contain `:` only when it splits into exactly three segments.
          jobId: `sigreminder:${meta.db_name}:live-${stamp}`,
          // One attempt. Each email is best-effort inside the sweep and the
          // counter advances per party, so a retry of the WHOLE sweep would
          // re-send to whoever already got one. The next hour's tick is the
          // retry.
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      enqueued += 1;
    } catch (err) {
      // One unreachable tenant must not stop the fan-out for the rest.
      logger.warn({ err, tenant: meta.db_name }, "[signatures] scheduler could not enqueue tenant");
      skipped += 1;
    }
  }

  logger.debug({ tenants: tenants.length, enqueued, skipped }, "[signatures] reminder tick");
  return { tenants: tenants.length, enqueued, skipped };
};
