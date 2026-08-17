/**
 * BullMQ queue producer — usable from ANY process (web or worker).
 *
 * The worker owns the consumers; this lets request-path code (e.g. smartcomm)
 * enqueue durable jobs onto the same queues without depending on the worker's
 * in-process queue map. Queue instances are lazily created on the shared Redis
 * connection and cached.
 */

"use strict";

const { Queue } = require("bullmq");
const { getClient } = require("../config/redis");
const requestContext = require("../config/request-context");

const queues = new Map();

function getQueue(name) {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: getClient() }));
  }
  return queues.get(name);
}

/**
 * Enqueue a job with sensible durability defaults (retry + exponential backoff,
 * trimmed history). Callers can override via `opts`.
 */
async function enqueue(name, jobName, data, opts = {}) {
  // OBS-T3: stamp ambient context
  const ctx = requestContext.get();
  const withCtx = ctx
    ? { ...data, __ctx: { tenant: ctx.tenant || null, user_id: ctx.userId || null, request_id: ctx.requestId || null } }
    : data;

  const queue = getQueue(name);

  // If a static jobId is provided for in-flight deduplication:
  // Remove any existing job that is already finished (completed or failed)
  // so it doesn't block future scheduler ticks from being enqueued. Active
  // or waiting jobs are preserved so in-flight work is properly deduped.
  if (opts && opts.jobId) {
    try {
      const existing = await queue.getJob(opts.jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed") {
          await existing.remove();
        }
      }
    } catch {
      /* @silent:teardown safe fallback when existing job lookup fails, proceed to add */
    }
  }

  return queue.add(jobName, withCtx, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
    ...opts,
  });
}

module.exports = { enqueue, getQueue };
