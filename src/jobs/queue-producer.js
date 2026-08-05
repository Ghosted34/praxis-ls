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
  // OBS-T3: the API → BullMQ → worker → handler chain carried no trace
  // identity, so a failed job could not be traced back to the user action that
  // enqueued it. Stamp the ambient context onto the payload; workers.js
  // restores it into AsyncLocalStorage, so the job's log lines carry the same
  // tenant, user and request_id as the request that created it.
  const ctx = requestContext.get();
  const withCtx = ctx
    ? { ...data, __ctx: { tenant: ctx.tenant || null, user_id: ctx.userId || null, request_id: ctx.requestId || null } }
    : data;

  return getQueue(name).add(jobName, withCtx, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...opts,
  });
}

module.exports = { enqueue };
