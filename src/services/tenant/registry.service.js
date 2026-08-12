/**
 * Tenant connection registry — resolves a request's Host header to a tenant and
 * hands out a pooled connection to THAT tenant's own Postgres database, bound to
 * the right schema (live | sandbox). One pool per tenant DB, created lazily and
 * cached. This is what replaces the old single-pool/RLS approach.
 * See doc/DB_ARCHITECTURE.md §1.
 */
"use strict";

const { Pool } = require("pg");
const { registerType } = require("pgvector/pg");
// Must load before the first query on any pool: it makes `date` columns arrive
// as `YYYY-MM-DD` strings rather than timezone-shifted Dates. See the module.
require("../../shared/db/pg-date-types");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const dbCredentials = require("./db-credential.service");

const HOST_TTL_MS = 60_000;
const hostCache = new Map(); // host -> { meta, expires }  (insertion-ordered => LRU)

/**
 * PERF S10. The host cache is keyed by ATTACKER-CONTROLLED INPUT and was never
 * evicted.
 *
 * Any client can send an arbitrary `Host` header. Each unknown host allocated a
 * permanent Map entry AND cost one platform-DB query — unbounded memory growth
 * plus a query-amplification vector, from an unauthenticated request. Negative
 * results were cached too, which helps the amplification but makes the growth
 * worse: every junk host is remembered forever.
 *
 * Two bounds. A hard cap with LRU eviction stops the growth; a periodic sweep
 * of expired entries stops a burst of one-off hosts sitting in memory until
 * something else pushes them out. Negative caching is KEPT — it is what stops the
 * DB query on a repeat of the same junk host — but a miss now expires sooner
 * than a hit, because a host that does not resolve is far more likely to be
 * noise than a host that does.
 */
const HOST_CACHE_MAX = Number(config.HOST_CACHE_MAX || 5_000);
const HOST_MISS_TTL_MS = 10_000;

/** Drop expired entries, then LRU-evict down to the cap. */
function trimHostCache() {
  const now = Date.now();
  for (const [h, v] of hostCache) {
    if (v.expires <= now) hostCache.delete(h);
  }
  while (hostCache.size > HOST_CACHE_MAX) {
    // Map iteration is insertion-ordered, so the first key is the oldest write.
    hostCache.delete(hostCache.keys().next().value);
  }
}
const pools = new Map(); // db_name -> Pool  (insertion-ordered => LRU by re-insert)
// db_name -> Promise<Pool>. WS-S2 made pool creation async (a vault read), so
// concurrent first-requests for the same tenant must share one creation rather
// than each building a pool and orphaning all but the last.
const inflight = new Map();

/**
 * PERF S1. Which schema a pooled connection is currently bound to.
 *
 * Symbol rather than a string key: these clients are long-lived, shared, and
 * handed back to `pg`, which owns the object.
 */
const SCHEMA = Symbol.for("praxis.conn.schema");

/**
 * WS-S1. Set by `acquire()` when the connection's schema is NOT the server-side
 * default and therefore has to be pinned inside a transaction — the pooled
 * sandbox case, and any tenant whose role predates the `ALTER ROLE ... SET
 * search_path` that `ensureTenantRole()` now applies.
 */
const NEEDS_PIN = Symbol.for("praxis.conn.needsPin");

/**
 * Whether a transaction pooler sits between this process and Postgres.
 *
 * Read once: it is deployment topology, not a runtime condition, and a value
 * that could change mid-process would make the search_path handling below
 * ambiguous in exactly the way that produces a silent wrong-schema read.
 */
const POOLED = Boolean(config.TENANT_DB_POOLER_HOST);

/**
 * PERF S1 — the global connection budget.
 *
 * The measured failure: one `pg.Pool` per tenant DB, `max: 8`, cached in an
 * UNBOUNDED Map. Postgres ships `max_connections=100`, so 12 warm tenants hold
 * 96 backend connections and tenant 13 is refused with "sorry, too many clients
 * already". Horizontal scaling made it worse, not better — each replica opens
 * its own pools, so three replicas cut the ceiling to ~4 tenants.
 *
 * Three things were missing and are added here:
 *
 *   1. A CAP ON THE NUMBER OF POOLS, with LRU eviction. A tenant that has not
 *      been touched in a while should not hold a pool open forever. The Map is
 *      insertion-ordered, so re-inserting on access makes it an LRU for free.
 *
 *   2. IDLE CONNECTIONS THAT ACTUALLY GO AWAY. `min: 0` plus an explicit idle
 *      timeout means a warm-but-quiet tenant settles back to zero backend
 *      connections instead of holding its full `max`.
 *
 *   3. A SEAM FOR PgBouncer. doc/DB_ARCHITECTURE.md:46 anticipates "PgBouncer
 *      at 10+ tenants" and the code had nowhere to put it. Setting
 *      TENANT_DB_POOLER_HOST routes every tenant pool through the pooler
 *      without touching a line of application code. That is the real answer
 *      above a few dozen tenants; everything else here buys the runway to get
 *      there.
 *
 * What this does NOT do is pretend a single process can serve unlimited
 * tenants. It converts a hard cliff — an unrecoverable connection error on an
 * unrelated tenant's request — into eviction and queueing, which degrade.
 */
const POOL_CACHE_MAX = Number(config.TENANT_POOL_CACHE_MAX || 24);
const POOL_IDLE_MS = Number(config.TENANT_POOL_IDLE_MS || 10_000);

// Lazy platform pool for registry lookups.
let platformPool = null;
function platform() {
  if (!platformPool) {
    platformPool = new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
      max: config.DB_POOL_MAX,
    });
  }
  return platformPool;
}

const normHost = (h) =>
  String(h || "")
    .toLowerCase()
    .split(":")[0]
    .trim();

/** Resolve a Host header to tenant metadata (cached). Returns null if unknown. */
async function resolveByHost(hostHeader) {
  const host = normHost(hostHeader);
  const hit = hostCache.get(host);
  if (hit && hit.expires > Date.now()) return hit.meta;

  const { rows } = await platform().query(
    `SELECT t.slug, t.tenant_id, t.status, t.is_live, t.sandbox_wipe_days,
            td.db_host, td.db_port, td.db_name, td.app_role, td.secret_ref,
            td.live_schema, td.sandbox_schema, td.pool_max
       FROM platform.subdomain s
       JOIN platform.tenant t ON t.tenant_id = s.tenant_id
       JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
      WHERE s.host = $1
      LIMIT 1`,
    [host],
  );
  const meta = rows[0] || null;
  // A resolved host is worth remembering for the full minute; an unresolved one
  // is probably a scanner, so it earns ten seconds — long enough to absorb a
  // burst without holding the entry.
  hostCache.set(host, {
    meta,
    expires: Date.now() + (meta ? HOST_TTL_MS : HOST_MISS_TTL_MS),
  });
  trimHostCache();
  return meta;
}

function invalidateHost(host) {
  hostCache.delete(normHost(host));
}

/**
 * Resolve a tenant SLUG to connection metadata (same shape resolveByHost
 * returns). Platform-pool read, uncached.
 *
 * Used where the tenant is carried in a trusted signed token rather than the
 * Host header — specifically the mail OAuth callback, whose single canonical
 * redirect URI serves every tenant (Google forbids wildcard redirect URIs), so
 * the tenant rides in the signed `state` and is resolved here by slug.
 */
async function resolveBySlug(slug) {
  const s = String(slug || "").toLowerCase().trim();
  if (!s) return null;
  const { rows } = await platform().query(
    `SELECT t.slug, t.tenant_id, t.status, t.is_live, t.sandbox_wipe_days,
            td.db_host, td.db_port, td.db_name, td.app_role, td.secret_ref,
            td.live_schema, td.sandbox_schema, td.pool_max
       FROM platform.tenant t
       JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
      WHERE t.slug = $1
      LIMIT 1`,
    [s],
  );
  return rows[0] || null;
}

/** The schema this tenant's connections default to when nothing says otherwise. */
const liveSchemaOf = (meta) => meta.live_schema || "live";
const schemaFor = (meta, env) =>
  env === "sandbox" ? meta.sandbox_schema || "sandbox" : liveSchemaOf(meta);

/**
 * Drop the least recently used pool once the cache is over its cap.
 *
 * `pool.end()` waits for in-flight queries and closes idle sockets, so an
 * eviction never interrupts a request that is mid-flight. It is fire-and-forget
 * on purpose: the caller wants a connection now, not to wait on someone else's
 * teardown.
 */
function evictIfNeeded() {
  while (pools.size > POOL_CACHE_MAX) {
    const [oldest, pool] = pools.entries().next().value;
    pools.delete(oldest);
    logger.info({ db: oldest, pools: pools.size }, "evicting least recently used tenant pool");
    Promise.resolve(pool.end()).catch((err) =>
      logger.warn({ err, db: oldest }, "tenant pool eviction failed"),
    );
  }
}

/**
 * Get (or create) the pool for a tenant DB.
 *
 * WS-S2 made this async: the tenant's password is resolved from the platform
 * vault, which is a query. That introduces a race the synchronous version could
 * not have — two concurrent requests for a tenant with no cached pool would both
 * miss, both await, and both construct a Pool, leaking one of them (its sockets
 * are never closed because only the second is stored). `inflight` collapses
 * concurrent creations onto one promise so exactly one pool is ever built.
 */
async function poolFor(meta) {
  const existing = pools.get(meta.db_name);
  if (existing) {
    // Re-insert to move to the end: the Map is insertion-ordered, so the first
    // entry is always the least recently used.
    pools.delete(meta.db_name);
    pools.set(meta.db_name, existing);
    return existing;
  }
  const pending = inflight.get(meta.db_name);
  if (pending) return pending;

  const creation = createPool(meta).finally(() => inflight.delete(meta.db_name));
  inflight.set(meta.db_name, creation);
  return creation;
}

/** Build a tenant pool. Only ever called through `poolFor`'s in-flight guard. */
async function createPool(meta) {
  const schema = liveSchemaOf(meta);

  // WS-S2: authenticate with THIS tenant's own credential when one has been
  // provisioned, falling back to the shared deploy-wide password otherwise, so
  // the rollout is incremental and a tenant that has not been rotated keeps
  // working. See db-credential.service.js.
  const cred = await dbCredentials.resolveCredential(meta);
  if (cred.source === "shared") {
    logger.debug(
      { db: meta.db_name, slug: meta.slug },
      "tenant pool using shared credential — WS-S2 backfill pending for this tenant",
    );
  }

  const pool = new Pool({
    // PERF S1 seam: point every tenant pool at PgBouncer by setting
    // TENANT_DB_POOLER_HOST. The tenant's own host/port stay in the registry so
    // migrations and provisioning (which must NOT go through a transaction
    // pooler) keep talking to Postgres directly.
    // HOST AND PORT MOVE TOGETHER, and that is the whole point of `POOLED`.
    //
    // INCIDENT 2026-08-12 (second half). These two resolved INDEPENDENTLY:
    //
    //     host: config.TENANT_DB_POOLER_HOST || meta.db_host,
    //     port: config.TENANT_DB_POOLER_PORT || meta.db_port,
    //
    // `.env.example` ships `TENANT_DB_POOLER_PORT=6432` next to an empty
    // `TENANT_DB_POOLER_HOST`, because a port with no host reads as harmless. It
    // is not: 6432 is truthy, so a deployment that copied the template sent every
    // tenant connection to the REAL Postgres host on the POOLER's port. Nothing
    // listens there — `ECONNREFUSED <postgres-ip>:6432` — and every tenant
    // request failed, with `TENANT_DB_POOLER_HOST` demonstrably empty and the
    // comment above it promising that meant "direct to Postgres".
    //
    // Half a pooler configuration is not a configuration. Either both values come
    // from the pooler or neither does.
    host: POOLED ? config.TENANT_DB_POOLER_HOST : meta.db_host,
    port: POOLED ? Number(config.TENANT_DB_POOLER_PORT) || 6432 : meta.db_port,
    database: meta.db_name,
    user: cred.user,
    password: cred.password,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    max: meta.pool_max || config.TENANT_POOL_MAX,

    // PERF S1: a quiet tenant must not keep holding backend connections.
    min: 0,
    idleTimeoutMillis: POOL_IDLE_MS,
    // Fail a checkout rather than hang forever behind a saturated pool. A 503
    // an operator can see beats a request that never returns.
    connectionTimeoutMillis: Number(config.TENANT_POOL_ACQUIRE_TIMEOUT_MS || 5_000),

    // PERF S2: bind the default search_path as a STARTUP PARAMETER. This is the
    // difference between paying a `SET search_path` round-trip on every single
    // checkout and paying none: the value arrives with the connection handshake.
    // A sandbox request still issues one SET (see acquire()), which is the
    // uncommon case.
    //
    // WS-S1 — NOT SENT WHEN A POOLER IS IN FRONT. PgBouncer rejects the `options`
    // startup parameter, so this line is why enabling the pooler would have
    // failed every tenant connection. Adding `options` to
    // `ignore_startup_parameters` looks like the fix and is worse: PgBouncer then
    // accepts the connection and DISCARDS the setting, so queries run on the
    // wrong search_path. When pooled, the schema comes from the role instead
    // (`ALTER ROLE ... IN DATABASE ... SET search_path`, set by
    // `ensureTenantRole()`), which the pooler cannot strip.
    ...(POOLED ? {} : { options: `-c search_path=${schema},public` }),
  });
  pool.on("connect", async (c) => {
    // Mirror the startup parameter so acquire() knows it need not re-SET.
    //
    // Only valid when we actually sent one. Under a pooler the schema is a role
    // default: still correct, still not something this connection set — but the
    // FIRST checkout must not assume it, because a tenant whose role predates the
    // ALTER ROLE would then silently run on `public`. `acquire()` verifies once
    // per connection instead.
    c[SCHEMA] = POOLED ? null : schema;
    try {
      await registerType(c);
    } catch {
      /* pgvector optional in some envs */
    }
  });
  pool.on("error", (err) =>
    logger.error({ err, db: meta.db_name }, "tenant pool error"),
  );
  pools.set(meta.db_name, pool);
  evictIfNeeded();
  return pool;
}

/**
 * Check out a connection bound to the right schema, and hand back an explicit
 * release.
 *
 * PERF S2. The old code issued `SET search_path` on EVERY checkout. Two changes
 * remove almost all of them:
 *
 *   - the pool sets the live schema as a startup parameter, so a fresh
 *     connection is already correct and costs nothing;
 *   - the connection remembers which schema it is on, so the SET is issued only
 *     when it actually has to change.
 *
 * A pooled connection that a sandbox request flipped is flipped back by the
 * next live request that lands on it. There is no reset-on-release, because a
 * reset is a round-trip too and the comparison already makes it unnecessary.
 *
 * WS-S1 — WHY THE POOLED PATH IS DIFFERENT
 *
 *   Under a TRANSACTION pooler, `SET search_path` issued outside a transaction is
 *   not reliable: node-postgres runs it as its own implicit transaction, after
 *   which PgBouncer may hand the underlying server connection to someone else.
 *   The next statement can land on a different backend that never saw the SET.
 *   Between `live` and `sandbox` for the SAME tenant that is a correctness bug;
 *   it is not a cross-tenant leak, because PgBouncer pools per (database, user)
 *   and each tenant has its own database and role.
 *
 *   So when pooled: `live` needs no statement at all — the role carries the
 *   search_path as a server-side default — and `sandbox` is pinned inside an
 *   explicit transaction by `withTenantConnection`, which is the only scope in
 *   which `SET LOCAL` is guaranteed to apply to the statements that follow it.
 */
async function acquire(meta, env) {
  const schema = schemaFor(meta, env);
  const client = await (await poolFor(meta)).connect();

  if (POOLED) {
    // Verify rather than assume, once per connection. A tenant provisioned before
    // the ALTER ROLE has no server-side default, and silently serving that tenant
    // from `public` is the failure mode worth one round-trip to rule out.
    try {
      if (client[SCHEMA] === null) {
        const { rows } = await client.query("SHOW search_path");
        client[SCHEMA] = String(rows[0].search_path || "").split(",")[0].trim();
      }
      if (client[SCHEMA] !== schema) {
        // Not the role default (sandbox, or a tenant missing the ALTER ROLE).
        // Caller must pin it transactionally — see withTenantConnection.
        client[NEEDS_PIN] = schema;
      } else {
        client[NEEDS_PIN] = null;
      }
    } catch (err) {
      client.release();
      throw err;
    }
    return client;
  }

  try {
    if (client[SCHEMA] !== schema) {
      await client.query(`SET search_path = ${schema}, public`);
      client[SCHEMA] = schema;
    }
  } catch (err) {
    client.release();
    throw err;
  }
  return client;
}

/** Run `fn(client)` on the tenant DB with search_path bound to the environment. */
async function withTenantConnection(meta, env, fn) {
  const client = await acquire(meta, env);
  const pin = POOLED ? client[NEEDS_PIN] : null;
  try {
    if (!pin) return await fn(client);

    // WS-S1 — the pooled sandbox path (and any tenant whose role predates the
    // server-side default). `SET LOCAL` is transaction-scoped, and a transaction
    // is the only thing a transaction pooler guarantees stays on one backend, so
    // this is the sole construct that makes the schema hold for `fn`'s
    // statements. Outside a transaction the setting can be silently dropped.
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path = ${pin}, public`);
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* the connection is going back to the pool either way */
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Host-cache occupancy, so PERF S10's bound is observable and not just asserted. */
function hostCacheStats() {
  return { size: hostCache.size, cap: HOST_CACHE_MAX };
}

/** Pools currently held, for /api/health/ready and the metrics endpoint. */
function poolStats() {
  const out = [];
  let total = 0;
  let idle = 0;
  let waiting = 0;
  for (const [db, p] of pools) {
    out.push({ db, total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount });
    total += p.totalCount;
    idle += p.idleCount;
    waiting += p.waitingCount;
  }
  return { pools: pools.size, cap: POOL_CACHE_MAX, connections: total, idle, waiting, detail: out };
}

/**
 * All LIVE tenants with an active database, as connection metas (same shape
 * resolveByHost returns). Used by background fan-out schedulers (orchestration
 * dispatch, aging, scheduled reports) to iterate tenants. Platform-pool read.
 */
async function listActiveTenants() {
  const { rows } = await platform().query(
    `SELECT t.slug, t.tenant_id, t.status, t.is_live, t.sandbox_wipe_days,
            td.db_host, td.db_port, td.db_name, td.app_role, td.secret_ref,
            td.live_schema, td.sandbox_schema, td.pool_max
       FROM platform.tenant t
       JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
      WHERE t.status = 'LIVE'
      ORDER BY t.slug`,
  );
  return rows;
}

/**
 * Drop a tenant's cached pool so the next request rebuilds it.
 *
 * WS-S2: a pool holds the password it was constructed with, so rotating a
 * tenant's credential is only half done until the pool built on the old one is
 * discarded. `pool.end()` waits for in-flight queries, so this does not
 * interrupt a request mid-flight — the same contract as LRU eviction.
 */
async function invalidatePool(dbName) {
  const pool = pools.get(dbName);
  if (!pool) return false;
  pools.delete(dbName);
  try {
    await pool.end();
  } catch (err) {
    logger.warn({ err, db: dbName }, "tenant pool close failed during invalidation");
  }
  return true;
}

async function closeAll() {
  for (const p of pools.values()) await p.end();
  pools.clear();
  inflight.clear();
  if (platformPool) {
    await platformPool.end();
    platformPool = null;
  }
}

module.exports = {
  resolveByHost,
  resolveBySlug,
  invalidateHost,
  invalidatePool,
  poolFor,
  acquire,
  withTenantConnection,
  listActiveTenants,
  poolStats,
  hostCacheStats,
  closeAll,
  SCHEMA,
};
