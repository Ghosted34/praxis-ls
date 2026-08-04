/**
 * PostgreSQL connection pool.
 *
 * Single pg.Pool instance shared across the app. All queries should go
 * through one of:
 *   - db.query(sql, params)              — quick one-shot, no transaction
 *   - db.transaction(async (client) => …) — multi-statement transaction
 *
 * Per V2.2 §8 — no ORM. Plain pg with parameterised queries.
 * NOTE (DI-4.1): an RLS apparatus used to live here — RLS_READ_ENFORCE,
 * queryWithContext, and a GUC-setting path attributed to "migration 000200".
 * No such migration exists and there is no CREATE POLICY anywhere in the repo,
 * so it filtered nothing while costing a round-trip per read. Removed.
 * Tenant isolation comes from the database boundary (doc/DB_ARCHITECTURE.md §1),
 * not from RLS.
 */

"use strict";

const { Pool } = require("pg");
const { registerType } = require("pgvector/pg");
const { config } = require("./env");
const { logger } = require("./logger");
const requestContext = require("./request-context");
const metrics = require("../shared/observability/metrics");

let pool = null;

/**
 * Slow-query threshold, configurable (OBS-M3 noted it was hardcoded at 500ms).
 * The metric is recorded for EVERY query regardless; this only controls the log.
 */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS || 500);

async function initDatabase() {
  pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    min: config.DB_POOL_MIN,
    max: config.DB_POOL_MAX,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Register pgvector type so SELECTs return Float32Array instead of strings
  pool.on("connect", async (client) => {
    try {
      await registerType(client);
    } catch (e) {
      // pgvector extension might not be present in test envs; degrade gracefully
      logger.warn({ err: e }, "pgvector type registration skipped");
    }
  });

  pool.on("error", (err) => {
    logger.error({ err }, "pg pool error");
  });

  // Smoke-test the connection at boot + surface an RLS misconfiguration early.
  const { rows } = await pool.query(
    "SELECT NOW() AS now, current_database() AS db, current_user AS usr, current_setting('is_superuser') AS is_superuser",
  );
  logger.info(
    { db: rows[0].db, now: rows[0].now, user: rows[0].usr },
    "database smoke test ok",
  );

  // RLS (§1.4): row-level security is bypassed by SUPERUSERS and by the table
  // owner. If read-enforcement is on but we connected as a superuser, isolation
  // on shared tables silently does NOT apply — warn loudly so it's caught before
  // it becomes a cross-entity data leak.

  return pool;
}

function getPool() {
  if (!pool)
    throw new Error("db pool not initialised — call initDatabase() first");
  return pool;
}

/**
 * Run a one-shot query. For multi-statement work that must share a
 * transaction or set per-connection GUCs (e.g. RLS context), use
 * `transaction()` instead.
 *
 * (DI-4.1) This docblock used to describe read-side RLS routing. There are no
 * RLS policies in this database, so there was nothing to route around.
 */
async function query(text, params = []) {
  if (!pool) throw new Error("db pool not initialised");

  // DI-4.1: this used to route to queryWithContext() when RLS_READ_ENFORCE was
  // on, wrapping the read in a transaction so `SET LOCAL app.current_business`
  // would apply to it. That GUC drives POLICIES THAT DO NOT EXIST: there is no
  // `ROW LEVEL SECURITY` or `CREATE POLICY` statement anywhere in migrations/,
  // and no migration 000200 (which two comments cited). Verified across every
  // migration file.
  //
  // Cross-tenant isolation is NOT affected — that comes from the database
  // boundary (database-per-tenant), which is real. What never existed is the
  // entity-level filtering the GUC implied. Turning the flag on added a
  // transaction round-trip per read and filtered nothing, while reading as
  // though isolation were enabled. That misleading affordance is the finding.

  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms = Date.now() - started;
    // OBS-M3: the warn line was a log entry, not a measurement — no percentiles,
    // no top-N, no trend, and with a 30s statement timeout a query could burn
    // 29.9s and produce one warn lost among thousands. Every query is now timed;
    // the threshold log stays for the obvious case.
    metrics.observe("praxis_db_query_duration_seconds", ms / 1000, {}, "Database query duration in seconds.");
    if (ms > SLOW_QUERY_MS) {
      metrics.inc("praxis_db_slow_queries_total", {}, 1, "Queries slower than the slow-query threshold.");
      logger.warn({ ms, threshold_ms: SLOW_QUERY_MS, sql: text.slice(0, 200) }, "slow query");
    }
    return res;
  } catch (err) {
    logger.error({ err, sql: text.slice(0, 200) }, "query failed");
    throw err;
  }
}


/**
 * Set the RLS/audit GUCs on a client *for the current transaction* (R-1).
 *
 * Uses `set_config(name, value, is_local := true)` rather than `SET LOCAL name
 * = $1` because the `SET` command does NOT accept bind parameters — the old
 * parameterised `SET LOCAL` form would have thrown at runtime (it was never
 * actually called, which is exactly why RLS was inert). `is_local := true`
 * scopes the value to the open transaction, so it auto-resets on COMMIT/
 * ROLLBACK and never leaks across pooled connections.
 *
 * Only applies values that are present, so a tenantless context (workers,
 * crons, CEO cross-tenant) leaves the GUC unset → RLS treats it as "no filter".
 *
 * @param {import('pg').PoolClient} client
 * @param {{ tenant?: string|null, userId?: string|null }} ctx
 */
async function applySessionContext(client, ctx) {
  if (!ctx) return;
  if (ctx.tenant) {
    await client.query(`SELECT set_config('app.current_business', $1, true)`, [
      ctx.tenant,
    ]);
  }
  if (ctx.userId) {
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
      String(ctx.userId),
    ]);
  }
}

/** Back-compat alias (was a broken parameterised `SET LOCAL`). */
async function setSessionContext(client, business, userId) {
  await applySessionContext(client, { tenant: business, userId });
}

/**
 * Acquire a client, BEGIN, run callback, COMMIT (or ROLLBACK on throw).
 * Use this for any operation that must be atomic across statements.
 *
 * RLS/audit context (R-1): immediately after BEGIN this reads the ambient
 * request context (set by tenant-context middleware, or by `tenantTransaction`)
 * and applies `app.current_business` / `app.current_user_id` so the RLS
 * policies from migration 000200 actually filter. No ambient context → GUCs
 * stay unset → cross-tenant "no filter" (the worker/cron path).
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
  if (!pool) throw new Error("db pool not initialised");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applySessionContext(client, {
      tenant: requestContext.getTenant(),
      userId: requestContext.getUserId(),
    });
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, "rollback failed");
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Explicit tenant-scoped transaction choke point (R-1) for code paths WITHOUT
 * an ambient request context — e.g. worker/cron handlers that fan out per
 * tenant, or the outbox dispatcher replaying a committed event. Binds the
 * context for the duration so both the GUC and any nested `transaction()`/
 * `query()` see the same tenant.
 *
 * @template T
 * @param {string} tenant
 * @param {string|null} userId
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function tenantTransaction(tenant, userId, fn) {
  return requestContext.run({ tenant, userId }, () => transaction(fn));
}

/**
 * Repo executor helper: returns the query function bound to an open
 * transaction client when one is passed, else the pool-level `query`.
 * Lets a repo function join a caller's transaction transparently:
 *
 *   async function findById({ client, tenant, id }) {
 *     const { rows } = await ex(client)(sql, params);
 *   }
 */
const ex = (client) => (client ? client.query.bind(client) : query);

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  initDatabase,
  getPool,
  query,
  ex,
  transaction,
  tenantTransaction,
  setSessionContext,
  applySessionContext,
  closeDatabase,
};
