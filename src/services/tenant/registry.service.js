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
const hostCache = new Map(); // host -> { meta, expires }
const pools = new Map(); // db_name -> Pool

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
  hostCache.set(host, { meta, expires: Date.now() + HOST_TTL_MS });
  return meta;
}

function invalidateHost(host) {
  hostCache.delete(normHost(host));
}

/** Get (or create) the pool for a tenant DB. */
function poolFor(meta) {
  let pool = pools.get(meta.db_name);
  if (pool) return pool;
  pool = new Pool({
    host: meta.db_host,
    port: meta.db_port,
    database: meta.db_name,
    user: config.TENANT_DB_APP_ROLE || config.DB_USER,
    password: config.DB_PASSWORD, // per-tenant secret resolved from secret store in prod
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    max: meta.pool_max || config.TENANT_POOL_MAX,
  });
  pool.on("connect", async (c) => {
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
  return pool;
}

/** Run `fn(client)` on the tenant DB with search_path bound to the environment. */
async function withTenantConnection(meta, env, fn) {
  const schema =
    env === "sandbox"
      ? meta.sandbox_schema || "sandbox"
      : meta.live_schema || "live";
  const client = await poolFor(meta).connect();
  try {
    await client.query(`SET search_path = ${schema}, public`);
    return await fn(client);
  } finally {
    client.release();
  }
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
  invalidateHost,
  poolFor,
  withTenantConnection,
  listActiveTenants,
  closeAll,
};
