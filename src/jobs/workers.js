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
  // Milestone SLA scan (MOD-31): re-baselines open chains and emits at-risk /
  // overdue / breach-forecast on health TRANSITIONS. concurrency 1 per queue —
  // the scan writes dates on every open chain in a tenant, and two concurrent
  // passes over the same dossier would race each other's re-baseline.
  { name: "milestone-sla", concurrency: 1, handler: require("./handlers/milestone-sla") },
  { name: "milestone-sla-scheduler", concurrency: 1, handler: require("./handlers/milestone-sla-scheduler") },
  { name: "company-profile-refresh", concurrency: 1, handler: require("./handlers/company-profile-refresh") },
  { name: "company-profile-refresh-scheduler", concurrency: 1, handler: require("./handlers/company-profile-refresh-scheduler") },
  // Uptime sampling for the Overview widget (§8.2). concurrency 1 is not a
  // performance choice — the uptime denominator assumes ONE sample per
  // interval, and a second concurrent worker would double the numerator.
  { name: "health-collect", concurrency: 1, handler: require("./handlers/health-collect") },
  // Backup + restore rehearsal (§3.2, WS-B1/B3). concurrency 1 is not a
  // throughput choice: parallel pg_dumps multiply I/O on a shared Postgres host,
  // and the entire reason this runs at 01:00 is to be cheap. A fleet backup that
  // saturates the disk is an outage with good intentions.
  { name: "backup-run", concurrency: 1, handler: require("./handlers/backup-run") },
  // Kaizen ops sweeps (§3.1/§3.4/§3.5): per-tenant health, uptime probing,
  // alert evaluation, retention. concurrency 1 — two concurrent health sweeps
  // would write two samples per interval per tenant and double-count.
  { name: "ops-sweep", concurrency: 1, handler: require("./handlers/ops-sweep") },
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

  // Nightly fleet backup (§3.2, WS-B1). Wall-clock cron for the same reason as
  // the error purge: D4's RPO is a promise about hours of data loss, and an
  // interval-based repeat drifts off the quiet window after every restart.
  const backupCron = config.BACKUP_CRON;
  if (!backupCron) {
    logger.warn(
      "NIGHTLY BACKUP DISABLED (BACKUP_CRON empty) — tenants have no scheduled backup",
    );
  } else {
    await enqueue("backup-run", "fleet", {}, {
      repeat: { pattern: backupCron, tz: "UTC" },
      removeOnComplete: true,
      // Backup failures are kept far longer than other jobs': the history of
      // which nights failed is the record that answers "how far back can we
      // actually restore this tenant".
      removeOnFail: 200,
    });
    // Retention runs two hours after the backup, not alongside it: pruning
    // before the night's dump has landed would delete the old copy that the
    // failed new one was meant to replace.
    const [min, hour, ...rest] = backupCron.split(" ");
    const pruneCron = [min, String((Number(hour) + 2) % 24), ...rest].join(" ");
    await enqueue("backup-run", "prune", {}, {
      repeat: { pattern: pruneCron, tz: "UTC" },
      removeOnComplete: true,
      removeOnFail: 20,
    });
    logger.info({ pattern: backupCron, prune: pruneCron }, "nightly fleet backup registered");

    // Object storage offsite sync (WS-B2). A Postgres dump does not cover vault
    // documents — the rows survive while the bytes they point at are gone —
    // so this runs on the same nightly cadence, one hour after the DB backup.
    const [oMin, oHour, ...oRest] = backupCron.split(" ");
    const objectCron = [oMin, String((Number(oHour) + 1) % 24), ...oRest].join(" ");
    await enqueue("backup-run", "objects", {}, {
      repeat: { pattern: objectCron, tz: "UTC" },
      removeOnComplete: true,
      removeOnFail: 200,
    });

    // Integrity scan (WS-B4). Weekly, not nightly: it reads every object's
    // bytes to re-hash them, which is far heavier than the sync and only needs
    // to run often enough to catch corruption BEFORE a restore needs the file.
    await enqueue("backup-run", "scan", {}, {
      repeat: { pattern: `${oMin} ${(Number(oHour) + 3) % 24} * * 0`, tz: "UTC" },
      removeOnComplete: true,
      removeOnFail: 200,
    });
    logger.info({ objects: objectCron }, "object sync + weekly integrity scan registered");

    // WAL archive health (WS-B1 layer 2). Every 15 minutes, NOT nightly: this
    // is the check that protects a 5-minute recovery objective, and a check
    // that runs once a day can only ever tell you the archive died sometime in
    // the last 24 hours — which is the very window the archive exists to
    // shorten. archive_command itself writes no bookkeeping (it sits on the
    // Postgres host's critical path), so a dead archiver is invisible until
    // this runs.
    if (config.WAL_ARCHIVE_ENABLED) {
      await enqueue("backup-run", "wal", {}, {
        repeat: { every: 15 * 60_000 },
        removeOnComplete: true,
        removeOnFail: 200,
      });
      // The lag limit itself is vault-first and read per check, so it is not
      // logged here — a value printed at registration would go stale the moment
      // someone changed it in the console.
      logger.info("WAL archive health check registered (every 15m)");
    } else {
      logger.info(
        "WAL archiving is OFF (WAL_ARCHIVE_ENABLED=false) — recovery is limited to the nightly dump, so the real RPO is 24h",
      );
    }
  }

  // Monthly restore rehearsal (§3.2, WS-B3). On by default: an unrehearsed
  // backup is the exact thing §3.2 identifies as not being a backup at all.
  const drillCron = config.RESTORE_DRILL_CRON;
  if (!drillCron) {
    logger.warn(
      "RESTORE DRILL DISABLED (RESTORE_DRILL_CRON empty) — backups will never be verified by restore",
    );
  } else {
    await enqueue("backup-run", "drill", {}, {
      repeat: { pattern: drillCron, tz: "UTC" },
      removeOnComplete: true,
      removeOnFail: 200,
    });
    logger.info({ pattern: drillCron }, "monthly restore drill registered");
  }

  // Per-tenant health sweep (§3.1, WS-H1/H2). This is the one that catches the
  // failure fleet-wide metrics are structurally blind to: the process is up,
  // thirty-nine tenants are fine, and one tenant's database is wedged.
  const tenantHealthEvery = config.TENANT_HEALTH_INTERVAL_MS;
  if (!tenantHealthEvery || tenantHealthEvery <= 0) {
    logger.info("per-tenant health sweep disabled (TENANT_HEALTH_INTERVAL_MS=0)");
  } else {
    await enqueue("ops-sweep", "health", {}, {
      repeat: { every: tenantHealthEvery },
      removeOnComplete: true,
      removeOnFail: 20,
    });
    logger.info({ every: tenantHealthEvery }, "per-tenant health sweep registered");
  }

  // Uptime probing (§3.4, WS-U1). The interval is also the denominator of the
  // availability figure, so changing it changes what past percentages mean.
  //
  // UPTIME_PROBE_IN_PROCESS is the switch, NOT the interval. Once
  // scripts/ops/uptime-probe.js runs as its own process — which is what WS-U1
  // actually asks for, since a prober inside the API cannot observe the API
  // being down — set it false. Leaving both on double-samples every host and
  // inflates availability; zeroing the interval instead would stop this sweep
  // but also redefine what every past percentage meant.
  const uptimeEvery = config.UPTIME_PROBE_INTERVAL_MS;
  if (!config.UPTIME_PROBE_IN_PROCESS) {
    logger.info("in-process uptime probing off (UPTIME_PROBE_IN_PROCESS=false) — expecting the external prober");
  } else if (!uptimeEvery || uptimeEvery <= 0) {
    logger.info("uptime probing disabled (UPTIME_PROBE_INTERVAL_MS=0)");
  } else {
    await enqueue("ops-sweep", "uptime", {}, {
      repeat: { every: uptimeEvery },
      removeOnComplete: true,
      removeOnFail: 20,
    });
    logger.info({ every: uptimeEvery }, "uptime probe registered (in-process)");
  }

  // Alert evaluation (§3.3, WS-ER1). Deliberately far less frequent than the
  // sweeps that feed it: measure often, notify rarely. A channel that repeats
  // the same RED tenant every five minutes is a channel people mute, and a
  // muted channel is the same as no alerting at all.
  await enqueue("ops-sweep", "alert", {}, {
    repeat: { every: Number(config.OPS_ALERT_INTERVAL_MS || 1_800_000) },
    removeOnComplete: true,
    removeOnFail: 20,
  });

  // Usage metering (§5, WS-S3). Hourly, not per-request: enforcement reads
  // these figures, and re-counting seats or re-summing an AI ledger on every
  // action would put a cross-database query on the critical path of the exact
  // operations a busy tenant does most.
  //
  // The trade is stated where it is enforced: a tenant can sit slightly over a
  // hard limit between sweeps. Hourly keeps that overshoot to a unit or two,
  // and the seat path — the one that matters commercially — takes a live count
  // anyway, because there the accuracy is free.
  await enqueue("ops-sweep", "usage", {}, {
    repeat: { every: Number(config.USAGE_METER_INTERVAL_MS || 3_600_000) },
    removeOnComplete: true,
    removeOnFail: 20,
  });
  logger.info("usage metering registered");

  // Ops retention shares the 02:00 UTC slot with the other purges.
  await enqueue("ops-sweep", "purge", {}, {
    repeat: { pattern: "0 2 * * *", tz: "UTC" },
    removeOnComplete: true,
    removeOnFail: 20,
  });
  logger.info("ops alert evaluation + retention registered");
  await enqueue("company-profile-refresh-scheduler", "tick", {}, {
    repeat: { pattern: "15 2 * * *", tz: "UTC" }, removeOnComplete: true, removeOnFail: 50,
  });
  logger.info("nightly company-profile refresh registered");
  // Milestone SLA scan (MOD-31). Wall-clock cron for the same reason as FX: the
  // whole point is landing at the start and the end of a working day, and an
  // interval-based repeat drifts off that after every restart. Empty
  // MILESTONE_SLA_CRON disables it; POST /milestones/dossier/:id/recalculate
  // still works by hand.
  const slaCron = config.MILESTONE_SLA_CRON;
  if (!slaCron) {
    logger.info("milestone SLA scheduler disabled (MILESTONE_SLA_CRON empty)");
  } else {
    await enqueue("milestone-sla-scheduler", "tick", {}, {
      repeat: { pattern: slaCron, tz: config.MILESTONE_SLA_TZ || "UTC" },
      removeOnComplete: true,
      removeOnFail: 50,
    });
    logger.info({ pattern: slaCron, tz: config.MILESTONE_SLA_TZ || "UTC" }, "milestone SLA scheduler registered");
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
