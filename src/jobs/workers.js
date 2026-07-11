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
const { initRedis, getClient, closeRedis } = require("../config/redis");

// name: BullMQ queue name; handler: async (job) => result; concurrency optional.
const PROCESSORS = [
  { name: "regie-aging", concurrency: 1, handler: require("./handlers/regie-aging") },
  { name: "pdf", concurrency: 2, handler: require("./handlers/pdf-render") },
  { name: "email", concurrency: 3, handler: require("./handlers/email-send") },
  { name: "fx-sync", concurrency: 1, handler: require("./handlers/fx-sync") },
  { name: "ai-transcribe", concurrency: 2, handler: require("./handlers/ai-transcribe") },
  { name: "ai-vision", concurrency: 2, handler: require("./handlers/ai-vision") },
  // Register queues here as each phase lands its jobs. Example:
  // { name: "pdf", concurrency: 2, handler: async (job) => require("../services/pdf").render(job.data) },
];

const workers = [];

function startWorkers() {
  const connection = getClient();
  if (PROCESSORS.length === 0) {
    logger.warn("worker started with no registered processors — idle. Add entries to PROCESSORS as jobs land.");
  }
  for (const p of PROCESSORS) {
    const worker = new Worker(
      p.name,
      async (job) => {
        logger.info({ queue: p.name, job: job.name, id: job.id }, "job start");
        const result = await p.handler(job);
        logger.info({ queue: p.name, job: job.name, id: job.id }, "job done");
        return result;
      },
      { connection, concurrency: p.concurrency || 5 },
    );
    worker.on("failed", (job, err) =>
      logger.error({ queue: p.name, job: job && job.name, id: job && job.id, err }, "job failed"),
    );
    worker.on("error", (err) => logger.error({ queue: p.name, err }, "worker error"));
    workers.push(worker);
    logger.info({ queue: p.name, concurrency: p.concurrency || 5 }, "worker registered");
  }
  return workers;
}

async function shutdown(sig) {
  logger.info({ sig }, "worker shutting down");
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeRedis();
  process.exit(0);
}

async function main() {
  process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "unhandledRejection (worker)"));
  process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException (worker)"));

  await initRedis();
  startWorkers();
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
