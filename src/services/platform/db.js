/**
 * Connection pools to the PLATFORM database (tenant registry, settings vault).
 *
 * TWO POOLS, NOT ONE — INCIDENT 2026-08-12
 * ----------------------------------------
 * There used to be one. Request handling and the Kaizen ops sweeps drew from it
 * together, so a background job could exhaust the connections a user request
 * needed. On 12 August that is exactly what happened: the health collector, the
 * uptime probe and `entitlement.measureFleet()` filled the pool, per-tenant
 * credential lookups queued behind them, tenant pool creation stalled, and every
 * tenant login timed out in `registry.acquire()`.
 *
 * The failure was not that the sweeps were slow. It is fine for a sweep to be
 * slow. The failure was that a sweep could make a LOGIN slow, and nothing in the
 * design prevented it.
 *
 *   `query()`    — serving path. Requests, auth, credential resolution.
 *   `opsQuery()` — background path. Health, uptime, entitlement, backup, alerts.
 *
 * `OPS_POOL_MAX` is small on purpose. Background work is allowed to queue against
 * itself; it is not allowed to queue against a user. Both pools count toward the
 * budget checked at boot (src/config/connection-budget.js).
 */
"use strict";

const { Pool } = require("pg");
const { config } = require("../../config/env");

function build(name, max) {
  const p = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    max,
    // Background work must fail rather than hang: a sweep that waits forever for
    // a connection holds its job slot and hides the saturation it is part of.
    connectionTimeoutMillis: Number(config.DB_CONNECT_TIMEOUT_MS || 10_000),
  });
  // An IDLE client that errors emits on the pool, and an unhandled 'error' event
  // takes the process down — a dropped connection to a database nobody was using
  // at that moment should not be fatal. `registry.service.js` has always done
  // this for tenant pools; the platform pool never had it.
  p.on("error", (err) => {
    try {
      // Required lazily: logger is cheap, but this module is required extremely
      // early and a cycle here would be a boot failure, not a log line.
      require("../../config/logger").logger.error({ err, pool: name }, "platform pool error");
    } catch {
      /* logging must never be the thing that fails */
    }
  });
  return p;
}

let pool = null;
function getPool() {
  if (!pool) pool = build("serving", config.DB_POOL_MAX);
  return pool;
}

let opsPool = null;
/**
 * The background pool. Separate from `getPool()` so that no amount of ops work
 * can starve the serving path — which is the specific coupling that took tenant
 * logins down on 2026-08-12.
 */
function getOpsPool() {
  if (!opsPool) opsPool = build("ops", config.OPS_POOL_MAX);
  return opsPool;
}

/** Serving path. Anything on a request's critical path belongs here. */
const query = (text, params) => getPool().query(text, params);

/**
 * Background path. Scheduled sweeps, collectors and maintenance belong here.
 *
 * If you are unsure which to use: ask whether a user is waiting for the answer.
 * If nobody is, use this one.
 */
const opsQuery = (text, params) => getOpsPool().query(text, params);

async function close() {
  const ending = [];
  if (pool) {
    ending.push(pool.end());
    pool = null;
  }
  if (opsPool) {
    ending.push(opsPool.end());
    opsPool = null;
  }
  await Promise.all(ending);
}

module.exports = { getPool, getOpsPool, query, opsQuery, close };
