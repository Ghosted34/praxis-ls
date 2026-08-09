/**
 * Background worker runtime (BullMQ consumer).
 *
 * The producer side (jobs/queue.js, jobs/queue-producer.js) already lets any
 * process enqueue durable jobs; this is the consumer that actually runs them.
 * It was a 0-byte stub — any job enqueued would have sat in Redis forever with
 * nothing to process it (doc/PHASE0_PRODUCTION_AUDIT.md).
 *
 * To add a job type (Phase 1's PDF/email/FX are first), register it in
 * PROCESSORS below — the runtime spins up a BullMQ Worker for it, wires
 * concurrency, structured logging, and graceful shutdown. No queue is invented
 * here; the registry ships empty and is the single, obvious extension point. The
 * process idles cleanly if nothing is registered, so it is safe to deploy now.
 */
"use strict";

const { Worker } = require("bullmq");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const metrics = require("../shared/observability/metrics");
const requestContext = require("../config/request-context");
const { report } = require("../shared/observability/error-reporter");
const { initRedis, createConnection, closeRedis } = require("../config/redis");

// name: BullMQ queue name; handler: async (job) => result; concurrency optional.
const PROCESSORS = [
  { name: "regie-aging", concurrency: 1, handler: require("./handlers/regie-aging") },
  { name: "pdf", concurrency: 2, handler: require("./handlers/pdf-render") },
  { name: "email", concurrency: 3, handler: require("./handlers/email-send") },
  { name: "fx-sync", concurrency: 1, handler: require("./handlers/fx-sync") },
  { name: "fx-sync-scheduler", concurrency: 1, handler: require("./handlers/fx-sync-scheduler") },
  { name: "ai-transcribe", concurrency: 2, handler: require("./handlers/ai-transcribe") },
  { name: "ai-vision", concurrency: 2, handler: require("./handlers/ai-vision") },
  { name: "scheduled-report", concurrency: 1, handler: require("./handlers/scheduled-report") },
  { name: "orchestration-dispatch", concurrency: 2, handler: require("./handlers/orchestration-dispatch") },
  { name: "orchestration-scheduler", concurrency: 1, handler: require("./handlers/orchestration-scheduler") },
  { name: "mail-sync", concurrency: 2, handler: require("./handlers/mail-sync") },
  { name: "mail-sync-scheduler", concurrency: 1, handler: require("./handlers/mail-sync-scheduler") },
  { name: "mail-webhook-renew", concurrency: 2, handler: require("./handlers/mail-webhook-renew") },
  { name: "mail-webhook-renew-scheduler", concurrency: 1, handler: require("./handlers/mail-webhook-renew-scheduler") },
  // Error Command Center: 30-day retention purge + escalation rule evaluation.
  { name: "error-maintenance", concurrency: 1, handler: require("./handlers/error-maintenance") },
  // Uptime sampling for the Overview widget (§8.2). concurrency 1 is not a
  // performance choice — the uptime denominator assumes ONE sample per
  // interval, and a second concurrent worker would double the numerator.
  { name: "health-collect", concurrency: 1, handler: require("./handlers/health-collect") },
  // Register queues here as each phase lands its jobs. Example:
  // { name: "pdf", concurrency: 2, handler: async (job) => require("../services/pdf").render(job.data) },
];

const workers = [];

function startWorkers() {
  if (PROCESSORS.length === 0) {
    logger.warn("worker started with no registered processors — idle. Add entries to PROCESSORS as jobs land.");
  }
  for (const p of PROCESSORS) {
    // PERF S11: one DEDICATED connection per worker. These were all given the
    // single shared client, and BullMQ workers block on BZPOPMIN/BRPOPLPUSH —
    // so they serialised against each other AND stalled the identity cache and
    // rate limiter, which share that same socket.
    const connection = createConnection(`worker:${p.name}`);
    const worker = new Worker(
      p.name,
      async (job) => {
        // OBS-T2: "job start"/"job done" were logged and elapsed time never
        // computed, so "is it slow or is it hung?" was unanswerable.
        // OBS-T3: the enqueuing request_id is carried on the job payload and
        // restored here, so a failed job traces back to the user action.
        const started = Date.now();
        const ctx = job.data && job.data.__ctx;

        // TENANT ATTRIBUTION FOR SCHEDULED JOBS.
        //
        // `__ctx` is only attached when something enqueued the job from INSIDE a
        // request (queue-producer stamps the ambient AsyncLocalStorage). A cron
        // fan-out has no ambient context, so every scheduled job ran with
        // `tenant: null` — and error-reporter reads `ctx.tenant`, so a nightly
        // fx-sync failure landed in the Error Center as **Platform-wide** even
        // though it belongs to exactly one tenant.
        //
        // The tenant was never missing, only unread: every tenant-scoped job
        // carries `tenantMeta` (the registry row) because the handler needs it
        // to open a connection at all. Falling back to its slug fixes the whole
        // class — fx-sync, mail-sync, orchestration-dispatch, scheduled-report —
        // rather than one queue, and costs nothing: the row is already in hand.
        const tenantSlug = (ctx && ctx.tenant)
          || (job.data && job.data.tenantMeta && job.data.tenantMeta.slug)
          || null;

        logger.info({ queue: p.name, job: job.name, id: job.id, tenant: tenantSlug, request_id: ctx && ctx.request_id }, "job start");
        try {
          const result = (ctx || tenantSlug)
            ? await requestContext.run(
                {
                  tenant: tenantSlug,
                  userId: ctx && ctx.user_id,
                  requestId: ctx && ctx.request_id,
                },
                () => p.handler(job),
              )
            : await p.handler(job);
          const ms = Date.now() - started;
          metrics.observe("praxis_job_duration_seconds", ms / 1000, { queue: p.name },
            "Background job duration in seconds.");
          metrics.inc("praxis_jobs_total", { queue: p.name, outcome: "ok" }, 1,
            "Background jobs by queue and outcome.");
          logger.info({ queue: p.name, job: job.name, id: job.id, ms }, "job done");
          return result;
        } catch (err) {
          const ms = Date.now() - started;
          metrics.observe("praxis_job_duration_seconds", ms / 1000, { queue: p.name });
          logger.error({ queue: p.name, job: job.name, id: job.id, ms, err }, "job threw");
          throw err;
        }
      },
      { connection, concurrency: p.concurrency || 5 },
    );
    // OBS-A7: BullMQ's `failed` fires PER ATTEMPT, so a transient blip and a
    // permanent failure looked identical in the logs and nothing aggregated
    // either. Attempts are counted; only exhaustion is reported, for the same
    // reason a retriable orchestration failure is not (OBS-A6): an alert that
    // fires on retries gets muted.
    worker.on("failed", (job, err) => {
      const attempts = (job && job.attemptsMade) || 0;
      const max = (job && job.opts && job.opts.attempts) || 1;
      const terminal = attempts >= max;
      metrics.inc("praxis_jobs_total", { queue: p.name, outcome: terminal ? "dead" : "retry" }, 1);
      logger.error(
        { queue: p.name, job: job && job.name, id: job && job.id, attempts, max, terminal, err },
        terminal ? "job FAILED PERMANENTLY — giving up" : "job attempt failed — will retry",
      );
      if (terminal) {
        report(err, {
          origin: "worker",
          severity: "fatal",
          route: `job/${p.name}/${job && job.name}`,
          extra: { queue: p.name, job_id: job && job.id, attempts, dropped: true },
        });
      }
    });
    worker.on("error", (err) => {
      metrics.inc("praxis_worker_errors_total", { queue: p.name }, 1, "Worker-level errors by queue.");
      logger.error({ queue: p.name, err }, "worker error");
    });
    // OBS-A5: the worker had no healthcheck and nothing tracked its liveness.
    // A heartbeat makes "the worker is alive" a fact rather than an assumption —
    // failure-by-absence is the class nobody notices until a customer asks
    // where their invoice went.
    worker.on("completed", () => metrics.inc("praxis_jobs_completed_total", { queue: p.name }, 1,
      "Jobs completed, by queue."));
    workers.push(worker);
    logger.info({ queue: p.name, concurrency: p.concurrency || 5 }, "worker registered");
  }
  return workers;
}

/**
 * Register the recurring orchestration tick (BullMQ repeat). Idempotent across
 * restarts — BullMQ dedupes a repeatable by its name + repeat options. Disabled
 * when the interval is 0.
 */
async function scheduleRecurring() {
  const every = config.ORCHESTRATION_DISPATCH_INTERVAL_MS;
  if (!every || every <= 0) {
    logger.info("orchestration scheduler disabled (ORCHESTRATION_DISPATCH_INTERVAL_MS=0)");
    return;
  }
   
  const { enqueue } = require("./queue-producer");
  await enqueue("orchestration-scheduler", "tick", {}, { repeat: { every }, removeOnComplete: true, removeOnFail: 50 });
  logger.info({ every }, "orchestration scheduler registered");

  // Mail engine (doc/EMAIL_ENGINE_PLAN.md §5): fan out an IMAP poll per LIVE
  // tenant. Idempotent across restarts (BullMQ dedupes a repeatable by name +
  // repeat options). Disabled when the interval is 0.
  const mailEvery = config.MAIL_SYNC_INTERVAL_MS;
  if (!mailEvery || mailEvery <= 0) {
    logger.info("mail sync scheduler disabled (MAIL_SYNC_INTERVAL_MS=0)");
  } else {
    await enqueue("mail-sync-scheduler", "tick", {}, { repeat: { every: mailEvery }, removeOnComplete: true, removeOnFail: 50 });
    logger.info({ every: mailEvery }, "mail sync scheduler registered");
  }

  // Mail push-subscription renewal (Graph/Gmail webhooks expire). Disabled at 0.
  const renewEvery = config.MAIL_WEBHOOK_RENEW_INTERVAL_MS;
  if (!renewEvery || renewEvery <= 0) {
    logger.info("mail webhook renew scheduler disabled (MAIL_WEBHOOK_RENEW_INTERVAL_MS=0)");
  } else {
    await enqueue("mail-webhook-renew-scheduler", "tick", {}, { repeat: { every: renewEvery }, removeOnComplete: true, removeOnFail: 50 });
    logger.info({ every: renewEvery }, "mail webhook renew scheduler registered");
  }

  // Error Command Center (doc/PROMPT_ErrorMonitor_Module.md §2.2, §5.3).
  //
  // Retention runs on a CRON at 02:00 UTC rather than `repeat.every`, because
  // the spec names a wall-clock time and an interval-based repeat drifts
  // relative to it after every restart. Escalation runs on an interval, because
  // what matters there is the gap between checks, not the time of day.
  await enqueue("error-maintenance", "purge", {}, {
    repeat: { pattern: "0 2 * * *", tz: "UTC" },
    removeOnComplete: true,
    removeOnFail: 20,
  });
  logger.info("error retention purge registered (02:00 UTC daily)");

  const escalateEvery = config.ERROR_ESCALATION_INTERVAL_MS;
  if (!escalateEvery || escalateEvery <= 0) {
    logger.info("error escalation evaluator disabled (ERROR_ESCALATION_INTERVAL_MS=0)");
  } else {
    await enqueue("error-maintenance", "escalate", {}, {
      repeat: { every: escalateEvery },
      removeOnComplete: true,
      removeOnFail: 50,
    });
    logger.info({ every: escalateEvery }, "error escalation evaluator registered");
  }

  // Health sampling (§8.2). Its retention purge shares the 02:00 UTC slot with
  // the error purge above and also sweeps read notifications — see
  // handlers/health-collect.js for why notifications are purged there.
  await enqueue("health-collect", "purge", {}, {
    repeat: { pattern: "0 2 * * *", tz: "UTC" },
    removeOnComplete: true,
    removeOnFail: 20,
  });

  const healthEvery = config.HEALTH_SAMPLE_INTERVAL_MS;
  if (!healthEvery || healthEvery <= 0) {
    logger.info("health sampling disabled (HEALTH_SAMPLE_INTERVAL_MS=0) — uptime will report null");
  } else {
    await enqueue("health-collect", "sample", {}, {
      repeat: { every: healthEvery },
      removeOnComplete: true,
      // Deliberately low. A failed sample is worthless five minutes later, and
      // retaining failures here would only hide the fact that the SAMPLES
      // themselves are the record of failure.
      removeOnFail: 20,
    });
    logger.info({ every: healthEvery }, "health sampler registered");
  }

  // Live FX daily sync (MOD-08). FX_SYNC_CRON is a wall-clock cron (default
  // midnight), so use repeat.pattern with a tz — an interval-based repeat would
  // drift off midnight after every restart, the same reasoning as the error
  // retention purge above. The scheduler fans out one fx-sync job per LIVE tenant
  // (base → all active currencies). Empty FX_SYNC_CRON disables it; "Sync now"
  // in the app still works.
  const fxCron = config.FX_SYNC_CRON;
  if (!fxCron) {
    logger.info("fx sync scheduler disabled (FX_SYNC_CRON empty)");
  } else {
    await enqueue("fx-sync-scheduler", "tick", {}, {
      repeat: { pattern: fxCron, tz: config.FX_SYNC_TZ || "UTC" },
      removeOnComplete: true,
      removeOnFail: 50,
    });
    logger.info({ pattern: fxCron, tz: config.FX_SYNC_TZ || "UTC" }, "fx sync scheduler registered");
  }
}

async function shutdown(sig) {
  logger.info({ sig }, "worker shutting down");
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeRedis();
  process.exit(0);
}

async function main() {
  // REPORTED, not just logged — spec §2.3 point 2.
  //
  // These two logged and stopped there, so a worker crash reached a log file on
  // a box whose logs are wiped on every deploy (OBS-L7) and nothing else. The
  // Error Center never saw it: `platform.error_event.origin` has a 'worker'
  // value in its CHECK constraint that nothing outside a job handler ever wrote.
  //
  // That is the wrong process to leave silent. The worker is what evaluates
  // escalation rules and samples uptime, so a worker that has died is also a
  // worker that will not tell anyone anything — including that it died. The
  // report goes through the same sink as the API's, which is durable.
  //
  // `report` is already imported at module scope; the local re-require that was
  // here shadowed it. Harmless today, but a second binding to the reporter is a
  // second copy of its dedupe and rate-limit state the moment anything resets
  // the module registry — so it uses the one import, like the rest of the file.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection (worker)");
    report(reason, { origin: "worker", severity: "error", route: "unhandledRejection" });
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException (worker)");
    report(err, { origin: "worker", severity: "fatal", route: "uncaughtException" });
  });

  await initRedis();
  startWorkers();
  await scheduleRecurring();
  logger.info({ env: config.NODE_ENV, queues: PROCESSORS.map((p) => p.name) }, "praxis-ls worker ready");

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, "worker failed to start");
    process.exit(1);
  });
}

module.exports = { PROCESSORS, startWorkers, main };
