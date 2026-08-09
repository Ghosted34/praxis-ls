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
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

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

/**
 * PERF S1. Which schema a pooled connection is currently bound to.
 *
 * Symbol rather than a string key: these clients are long-lived, shared, and
 * handed back to `pg`, which owns the object.
 */
const SCHEMA = Symbol.for("praxis.conn.schema");

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
            td.db_host, td.db_port, td.db_name, td.app_role, td.live_schema, td.sandbox_schema, td.pool_max
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
            td.db_host, td.db_port, td.db_name, td.app_role, td.live_schema, td.sandbox_schema, td.pool_max
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

/** Get (or create) the pool for a tenant DB. */
function poolFor(meta) {
  const existing = pools.get(meta.db_name);
  if (existing) {
    // Re-insert to move to the end: the Map is insertion-ordered, so the first
    // entry is always the least recently used.
    pools.delete(meta.db_name);
    pools.set(meta.db_name, existing);
    return existing;
  }
  const schema = liveSchemaOf(meta);
  const pool = new Pool({
    // PERF S1 seam: point every tenant pool at PgBouncer by setting
    // TENANT_DB_POOLER_HOST. The tenant's own host/port stay in the registry so
    // migrations and provisioning (which must NOT go through a transaction
    // pooler) keep talking to Postgres directly.
    host: config.TENANT_DB_POOLER_HOST || meta.db_host,
    port: config.TENANT_DB_POOLER_PORT || meta.db_port,
    database: meta.db_name,
    user: config.TENANT_DB_APP_ROLE || config.DB_USER,
    password: config.DB_PASSWORD, // per-tenant secret resolved from secret store in prod
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
    options: `-c search_path=${schema},public`,
  });
  pool.on("connect", async (c) => {
    // Mirror the startup parameter so acquire() knows it need not re-SET.
    c[SCHEMA] = schema;
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
 */
async function acquire(meta, env) {
  const schema = schemaFor(meta, env);
  const client = await poolFor(meta).connect();
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
  try {
    return await fn(client);
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
            td.db_host, td.db_port, td.db_name, td.app_role, td.live_schema, td.sandbox_schema, td.pool_max
       FROM platform.tenant t
       JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
      WHERE t.status = 'LIVE'
      ORDER BY t.slug`,
  );
  return rows;
}

async function closeAll() {
  for (const p of pools.values()) await p.end();
  pools.clear();
  if (platformPool) {
    await platformPool.end();
    platformPool = null;
  }
}

module.exports = {
  resolveByHost,
  resolveBySlug,
  invalidateHost,
  poolFor,
  acquire,
  withTenantConnection,
  listActiveTenants,
  poolStats,
  hostCacheStats,
  closeAll,
  SCHEMA,
};
