/**
 * WS-H1 / WS-H2 — per-tenant fleet health.
 *
 * §3.1's goal is that "50 tenants are as observable and recoverable as 5". The
 * signals largely exist already — `registry.poolStats()`, `fleetSchemaStatus()`,
 * the metrics endpoint, `/api/health/ready`. What did not exist is aggregation
 * per tenant, over time, with one shared definition of "bad".
 *
 * THE FAILURE MODE THIS IS FOR
 *
 *   The process is up. Postgres is up. Redis is up. Thirty-nine tenants are
 *   serving normally and one tenant's database is refusing connections. Every
 *   fleet-wide metric reads green, because at the fleet level everything IS
 *   green — the platform is not broken, one tenant is. That tenant finds out by
 *   telephoning someone.
 *
 *   WS-H2's synthetic liveness probe is the direct answer: an actual query
 *   through that tenant's own pool. Not "can the process reach Postgres" but
 *   "can this tenant's request path complete", which is the only question a
 *   tenant cares about.
 *
 * ONE STATUS FUNCTION, USED BY BOTH READERS
 *
 *   `statusFor()` is the single place GREEN/AMBER/RED is decided, and its
 *   verdict is STORED rather than re-derived on read. If the console computed
 *   its own colour and alerting computed another, they would disagree exactly
 *   when it mattered — during an incident, which is the one time two systems
 *   telling different stories is unaffordable.
 */
"use strict";

const platformDb = require("./db");
const registry = require("../tenant/registry.service");
const provisioning = require("./provisioning.service");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");

/**
 * Decide a tenant's colour from its signals.
 *
 * RED   — the tenant cannot serve: database unreachable, liveness failing, or
 *         the connection pool saturated with requests queueing behind it.
 * AMBER — degraded or at risk: schema drift, elevated job failures, recent
 *         errors, mail unverified. Serving, but something needs attention.
 * GREEN — none of the above.
 *
 * Returns the reasons alongside the status, because a colour with no reason is
 * a colour someone has to reverse-engineer at 3am.
 */
function statusFor(signals) {
  const reasons = [];
  let status = "GREEN";

  const red = (why) => {
    reasons.push(why);
    status = "RED";
  };
  const amber = (why) => {
    reasons.push(why);
    if (status !== "RED") status = "AMBER";
  };

  if (signals.schema_unreachable) red("database unreachable");
  // Liveness explicitly false, not merely absent: a tenant whose probe did not
  // run is unknown, not broken, and colouring unknown as RED trains people to
  // ignore the colour.
  //
  // The REASON carries the underlying error. "tenant liveness probe failed" on
  // its own tells an operator that something is wrong and nothing about what —
  // which means opening a shell and reproducing it by hand, at exactly the
  // moment that is most expensive.
  if (signals.liveness_ok === false) {
    red(
      signals.liveness_error
        ? `tenant liveness probe failed: ${signals.liveness_error}`
        : "tenant liveness probe failed",
    );
  }
  if (signals.pool_waiting > 0) red("connection pool saturated (requests queueing)");
  if (signals.redis_ok === false) red("redis unreachable");

  if (signals.schema_behind > 0) amber(`schema ${signals.schema_behind} migration(s) behind`);
  if (signals.jobs_failed_24h > Number(config.HEALTH_JOB_FAILURE_AMBER || 5)) {
    amber(`${signals.jobs_failed_24h} job failures in 24h`);
  }
  if (signals.error_count_24h > Number(config.HEALTH_ERROR_AMBER || 50)) {
    amber(`${signals.error_count_24h} errors in 24h`);
  }
  if (signals.mail_verified === false) amber("mail domain not verified");
  if (signals.liveness_ms && signals.liveness_ms > Number(config.HEALTH_LIVENESS_SLOW_MS || 2000)) {
    amber(`tenant query slow (${signals.liveness_ms}ms)`);
  }

  return { status, reasons };
}

/**
 * WS-H2 — synthetic per-tenant liveness.
 *
 * A real query through the tenant's own pool. `SELECT 1` alone would prove only
 * that a socket opened, so this also reads a row from a table every tenant has:
 * it exercises the pool, the credential, the search_path and the schema in one
 * go, which together are the tenant request path.
 */
async function probeTenant(meta) {
  const started = Date.now();
  try {
    const ok = await registry.withTenantConnection(meta, "live", async (client) => {
      await client.query("SELECT 1");
      // Touching a real table catches the case where the connection works but
      // the schema is missing or the role cannot read it — a wedge that
      // `SELECT 1` reports as perfectly healthy.
      await client.query("SELECT count(*) FROM app_user");
      return true;
    });
    return { liveness_ok: ok === true, liveness_ms: Date.now() - started, liveness_error: null };
  } catch (err) {
    return { liveness_ok: false, liveness_ms: Date.now() - started, liveness_error: err.message };
  }
}

/** Per-tenant error counts from the tenant's own error log, if present. */
async function errorSignals(meta) {
  try {
    return await registry.withTenantConnection(meta, "live", async (client) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n, max(created_at) AS last_at
           FROM error_event WHERE created_at > now() - interval '24 hours'`,
      );
      return { error_count_24h: rows[0].n, last_error_at: rows[0].last_at };
    });
  } catch {
    // No error_event table in this tenant, or it is unreachable — the liveness
    // probe already covers unreachable, so this is simply "no signal".
    return { error_count_24h: null, last_error_at: null };
  }
}

/**
 * Snapshot every LIVE tenant's health into `platform.tenant_health`.
 *
 * NEVER THROWS on a single tenant: the whole purpose is to record that a tenant
 * is broken, and letting one broken tenant abort the sweep would lose the
 * observation for every tenant after it in the list — including the ones that
 * are fine.
 */
async function collectFleetHealth(opts = {}) {
  const tenants = opts.tenants || (await registry.listActiveTenants());

  // One fleet-wide schema read rather than one per tenant: it opens a
  // superuser connection per tenant DB internally and doing that twice per
  // sweep doubles the cost of the cheapest signal here.
  let schemaByTenant = new Map();
  try {
    const fleet = await provisioning.fleetSchemaStatus();
    schemaByTenant = new Map(fleet.tenants.map((t) => [t.slug, t]));
  } catch (err) {
    logger.warn({ err }, "fleet schema status unavailable for health sweep");
  }

  const poolStats = registry.poolStats();
  const poolByDb = new Map(poolStats.detail.map((p) => [p.db, p]));

  const captured = [];
  for (const meta of tenants) {
    const schema = schemaByTenant.get(meta.slug) || {};
    const pool = poolByDb.get(meta.db_name) || {};
    const liveness = await probeTenant(meta);
    const errors = await errorSignals(meta);

    const signals = {
      pool_total: pool.total ?? null,
      pool_idle: pool.idle ?? null,
      pool_waiting: pool.waiting ?? null,
      schema_behind: schema.behind ?? null,
      schema_unreachable: Boolean(schema.error),
      jobs_failed_24h: null, // populated by the queue metrics collector
      mail_verified: null, // populated once WS-E5 lands email_domain
      redis_ok: opts.redis_ok ?? null,
      ...liveness,
      ...errors,
    };
    const { status, reasons } = statusFor(signals);

    try {
      await platformDb.query(
        `INSERT INTO platform.tenant_health
           (tenant_id, pool_total, pool_idle, pool_waiting, schema_behind, schema_unreachable,
            jobs_failed_24h, mail_verified, redis_ok, liveness_ok, liveness_ms,
            last_error_at, error_count_24h, status, reasons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
        [
          meta.tenant_id,
          signals.pool_total,
          signals.pool_idle,
          signals.pool_waiting,
          signals.schema_behind,
          signals.schema_unreachable,
          signals.jobs_failed_24h,
          signals.mail_verified,
          signals.redis_ok,
          signals.liveness_ok,
          signals.liveness_ms,
          signals.last_error_at,
          signals.error_count_24h,
          status,
          JSON.stringify(reasons),
        ],
      );
    } catch (err) {
      logger.error({ err, slug: meta.slug }, "could not record tenant health sample");
    }

    captured.push({ slug: meta.slug, status, reasons, liveness_ms: signals.liveness_ms });
    if (status === "RED") {
      logger.error({ slug: meta.slug, reasons }, "tenant health RED");
    }
  }

  const summary = {
    total: captured.length,
    red: captured.filter((c) => c.status === "RED").length,
    amber: captured.filter((c) => c.status === "AMBER").length,
    green: captured.filter((c) => c.status === "GREEN").length,
    tenants: captured,
  };
  logger.info({ ...summary, tenants: undefined }, "fleet health sweep complete");
  return summary;
}

/** Latest sample per tenant — the fleet grid. */
async function fleetHealth() {
  const { rows } = await platformDb.query(
    `SELECT t.slug, t.tenant_id, h.*
       FROM platform.tenant t
       LEFT JOIN LATERAL (
         SELECT * FROM platform.tenant_health
          WHERE tenant_id = t.tenant_id
          ORDER BY captured_at DESC LIMIT 1
       ) h ON true
      WHERE t.status='LIVE'
      ORDER BY
        -- Worst first: an operator opening this page wants the problems, not
        -- an alphabetical list they have to scan for red.
        CASE h.status WHEN 'RED' THEN 0 WHEN 'AMBER' THEN 1 ELSE 2 END,
        t.slug`,
  );
  return {
    tenants: rows,
    red: rows.filter((r) => r.status === "RED").length,
    amber: rows.filter((r) => r.status === "AMBER").length,
    unknown: rows.filter((r) => !r.status).length,
  };
}

/** One tenant's history, for the drill-down chart. */
async function tenantHistory(tenantId, { hours = 24 } = {}) {
  const { rows } = await platformDb.query(
    `SELECT * FROM platform.tenant_health
      WHERE tenant_id=$1 AND captured_at > now() - ($2 || ' hours')::interval
      ORDER BY captured_at`,
    [tenantId, String(hours)],
  );
  return rows;
}

/** Retention: health samples are operational, not historical record. */
async function purge({ days = 30 } = {}) {
  const { rowCount } = await platformDb.query(
    `DELETE FROM platform.tenant_health WHERE captured_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return { deleted: rowCount };
}

module.exports = {
  statusFor,
  probeTenant,
  collectFleetHealth,
  fleetHealth,
  tenantHistory,
  purge,
};
