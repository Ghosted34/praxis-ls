/**
 * Worker job: scheduled-report fan-out. One `scheduled-report` job per live
 * tenant.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `scheduled-report` has been a registered worker since reports shipped and
 * nothing in the app ever enqueued it. Its own header named the missing half —
 * "the periodic trigger (an app scheduled-task or external cron) enqueues one
 * job per live tenant" — and left it to a deployment step that was never part
 * of the repo. So a tenant who scheduled a weekly receivables report got a row
 * in `scheduled_report`, a `next_run_at` that arrived and then sat in the past,
 * and no email, unless somebody remembered to POST /reports/scheduled/run-due
 * by hand.
 *
 * This is the same defect `regie-aging-scheduler` was written to fix, in the
 * same directory, for the same reason. It is the last of them.
 *
 * ── WHY HOURLY, NOT DAILY ───────────────────────────────────────────────────
 *
 * `next_run_at` is a timestamp and `listDueScheduled` asks `next_run_at <=
 * now()`, so the tick frequency IS the resolution of the whole feature. A daily
 * tick would make every cadence mean "whenever the tick happens to run", and a
 * report a finance lead set for Monday morning would arrive Monday at whatever
 * hour the fleet cron fires. Hourly costs one cheap query per tenant per hour —
 * `listDueScheduled` is an indexed range scan that returns nothing 23 times out
 * of 24 — and bounds the lateness at an hour.
 *
 * ── WHY LIVE ONLY ───────────────────────────────────────────────────────────
 *
 * Reports EMAIL people. `email.service`'s sandbox guard already suppresses the
 * send, so a Test run would generate the report, suppress the mail, and still
 * advance `next_run_at` — a rehearsal that consumed the schedule without
 * rehearsing anything. Test remains reachable through the route for anyone
 * deliberately exercising the flow, which is the same line
 * `contract-lapse-scheduler` and `regie-aging-scheduler` draw.
 *
 * ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
 *
 * `runDue` advances `next_run_at` on every row it touches, so a second tick in
 * the same hour re-selects nothing. The per-tenant `jobId` additionally dedupes
 * an in-flight run, so a tenant whose reports take longer than the interval
 * never piles up.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

/** `YYYY-MM-DDTHH` — the tick's own hour, for the dedupe key. */
const hourStamp = () => new Date().toISOString().slice(0, 13);

module.exports = async function scheduledReportScheduler() {
  const tenants = await registry.listActiveTenants();
  const stamp = hourStamp();
  let enqueued = 0;
  let skipped = 0;

  for (const meta of tenants) {
    try {
      await enqueue(
        "scheduled-report",
        "run-due",
        { tenantMeta: meta, env: "live" },
        {
          // `live-<hour>` rather than `live:<hour>`: a BullMQ custom job id may
          // contain `:` only when it splits into exactly three segments, and a
          // fourth throws `Custom Id cannot contain :`. Same shape as
          // regie-aging-scheduler, for the same reason.
          jobId: `schedreport:${meta.db_name}:live-${stamp}`,
          // One attempt. The work is a report generation plus emails that are
          // themselves queued with their own retries; re-running the whole
          // sweep on a transient failure would re-generate reports that already
          // went out. The next hour's tick is the retry.
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      enqueued += 1;
    } catch (err) {
      // One unreachable tenant must not stop the fan-out for the rest — the
      // whole point of a per-tenant job is isolation.
      logger.warn({ err, tenant: meta.db_name }, "[reports] scheduler could not enqueue tenant");
      skipped += 1;
    }
  }

  logger.debug({ tenants: tenants.length, enqueued, skipped }, "[reports] scheduled-report tick");
  return { tenants: tenants.length, enqueued, skipped };
};
