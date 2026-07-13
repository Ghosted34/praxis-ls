/**
 * Redis client.
 *
 * Used for:
 *   - Identity cache — per-request user / tenant-config / permission-grant
 *     lookups with event-driven invalidation (shared/cache/identity-cache.js)
 *   - Sessions (refresh tokens, password-reset tokens, revocation)
 *   - Pub/Sub coordination across Socket.io workers (redis adapter)
 *   - BullMQ job queues (workers and scheduled jobs)
 *   - Rate limiting (express-rate-limit Redis store)
 */

"use strict";

const IORedis = require("ioredis");
const { config } = require("./env");
const { logger } = require("./logger");

let client = null;
let publisher = null;
let subscriber = null;

/**
 * This previously read config.REDIS_HOST/PORT/PASSWORD/DB, none of which
 * exist in src/config/env.js's Zod schema (only REDIS_URL does) — flagged
 * as dead config drift in doc/RBAC_SECURITY_KICKOFF.md and left alone at
 * the time. Now fixed for real: ioredis takes a connection string directly,
 * and REDIS_URL already carries host/port/password/db (redis://[:pass@]
 * host:port[/db]) — no need to hand-parse it into separate fields.
 */
function buildOptions() {
  return {
    maxRetriesPerRequest: null, // BullMQ requires null
    enableReadyCheck: true,
    reconnectOnError(err) {
      logger.warn({ err: err.message }, "redis reconnecting");
      return true;
    },
  };
}

async function initRedis() {
  client = new IORedis(config.REDIS_URL, buildOptions());
  publisher = new IORedis(config.REDIS_URL, buildOptions());
  subscriber = new IORedis(config.REDIS_URL, buildOptions());

  for (const [name, c] of [
    ["main", client],
    ["publisher", publisher],
    ["subscriber", subscriber],
  ]) {
    c.on("error", (err) => logger.error({ err, conn: name }, "redis error"));
    c.on("connect", () => logger.debug({ conn: name }, "redis connected"));
  }

  await client.ping();
  return client;
}

function getClient() {
  if (!client) throw new Error("redis not initialised");
  return client;
}

function getPublisher() {
  if (!publisher) throw new Error("redis publisher not initialised");
  return publisher;
}

function getSubscriber() {
  if (!subscriber) throw new Error("redis subscriber not initialised");
  return subscriber;
}

async function closeRedis() {
  await Promise.allSettled([
    client?.quit(),
    publisher?.quit(),
    subscriber?.quit(),
  ]);
  client = publisher = subscriber = null;
}

module.exports = {
  initRedis,
  getClient,
  getPublisher,
  getSubscriber,
  closeRedis,
};
