/**
 * WS-S1 — PgBouncer telemetry for the health collector.
 *
 * `pgbouncer.ini.template` already promises this: "SHOW POOLS / SHOW STATS come
 * from here; the health collector reads them to put server-vs-client connection
 * counts into tenant_health." The admin user was granted, the stanza was
 * written, and nothing ever read it. This is that reader.
 *
 * ── WHY THIS MATTERS MORE THAN IT LOOKS ────────────────────────────────────
 *
 *   Every connection number the health collector records today is measured
 *   inside this process, against its own `pg` pools. That is the right ceiling
 *   while the app talks to Postgres directly. The moment PgBouncer carries
 *   traffic it is the wrong one: the app's pool becomes a pool of connections to
 *   the POOLER, which is cheap and plentiful by design, while the constraint
 *   moves to the pooler's server-side pool against `max_connections`. An app-side
 *   pool sitting at 20% while PgBouncer queues clients would read as healthy
 *   right up to the outage.
 *
 * ── WHY A SEPARATE CONNECTION, AND WHY A SEPARATE MODULE ───────────────────
 *
 *   PgBouncer's admin console is a fake database (`pgbouncer`) that speaks just
 *   enough of the protocol to answer SHOW commands. It does not support extended
 *   query protocol, so parameterised queries fail — every statement here is a
 *   literal, which is safe only because nothing user-supplied is interpolated
 *   into one. Keeping that constraint in its own file is the point: it must not
 *   become a place where someone reasonably assumes `$1` works.
 *
 * ── FAILURE IS NOT AN ERROR ────────────────────────────────────────────────
 *
 *   Every function here returns null instead of throwing. This feeds a health
 *   collector: telemetry that can fail the sweep would mean an unreachable
 *   pooler costs the observation for every OTHER signal, which inverts the
 *   purpose. An unreachable pooler shows up as a missing measurement and, if it
 *   is supposed to be carrying traffic, as tenants that cannot connect at all —
 *   a signal nobody needs this module to notice.
 */
"use strict";

const { Pool } = require("pg");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

/** True only when a pooler is actually configured to carry traffic. */
const enabled = () => Boolean(config.TENANT_DB_POOLER_HOST);

/**
 * How long to wait on the admin console before giving up.
 *
 * Short, and deliberately so: this runs once per health sweep, and a hung
 * admin connection would delay every tenant's sample behind it. The measurement
 * is worth having and never worth waiting for.
 */
const ADMIN_TIMEOUT_MS = 2_000;

let adminPool = null;

/**
 * The admin-console pool.
 *
 * `max: 1` because SHOW commands are serialised on the pooler anyway and a
 * second connection buys nothing but a way to consume one of PgBouncer's own
 * client slots. `min: 0` so a deployment that never reads stats holds nothing.
 */
function admin() {
  if (!adminPool) {
    adminPool = new Pool({
      host: config.TENANT_DB_POOLER_HOST,
      port: Number(config.TENANT_DB_POOLER_PORT) || 6432,
      // The admin console is reached by connecting to the literal database name
      // "pgbouncer". It is not a real database and cannot be queried as one.
      database: "pgbouncer",
      user: config.PGBOUNCER_AUTH_USER || "pgbouncer",
      password: config.PGBOUNCER_AUTH_PASSWORD || "",
      max: 1,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: ADMIN_TIMEOUT_MS,
      // The admin console rejects SSL negotiation regardless of the upstream's
      // setting, so this must not inherit DB_SSL.
      ssl: false,
      // PgBouncer's admin console does not implement the extended query
      // protocol. node-postgres uses simple query mode when no values are bound,
      // which is why every statement here is a literal with no parameters.
      statement_timeout: ADMIN_TIMEOUT_MS,
    });
    adminPool.on("error", (err) =>
      logger.debug({ err }, "pgbouncer admin pool error (telemetry only)"),
    );
  }
  return adminPool;
}

/** Run one SHOW command. Returns rows, or null if the console is unreachable. */
async function show(command) {
  if (!enabled()) return null;
  try {
    const { rows } = await admin().query(command);
    return rows;
  } catch (err) {
    logger.debug({ err, command }, "pgbouncer admin query failed — pooler telemetry unavailable");
    return null;
  }
}

/**
 * `SHOW POOLS`, keyed by database name.
 *
 * PgBouncer reports one row per (database, user) pair. Praxis is one database
 * per tenant with one role per tenant, so in practice that is one row per
 * tenant — but the pair is NOT guaranteed unique per database during a WS-S2
 * rollout, when a tenant may briefly be reachable under both the shared role and
 * its own. Rows are therefore SUMMED per database rather than overwritten, so a
 * half-migrated tenant reports its true total instead of whichever row happened
 * to come last.
 */
async function pools() {
  const rows = await show("SHOW POOLS");
  if (!rows) return null;

  const byDb = new Map();
  for (const r of rows) {
    const db = r.database;
    // The admin console's own pool is not tenant traffic and would distort every
    // fleet-level total it appears in.
    if (!db || db === "pgbouncer") continue;

    const prev = byDb.get(db) || {
      cl_active: 0,
      cl_waiting: 0,
      sv_active: 0,
      sv_idle: 0,
      maxwait_us: 0,
    };
    byDb.set(db, {
      cl_active: prev.cl_active + (Number(r.cl_active) || 0),
      cl_waiting: prev.cl_waiting + (Number(r.cl_waiting) || 0),
      sv_active: prev.sv_active + (Number(r.sv_active) || 0),
      sv_idle: prev.sv_idle + (Number(r.sv_idle) || 0),
      // maxwait is the LONGEST current wait, so summing it would be meaningless.
      // The worst of the pair is the number that describes the tenant.
      maxwait_us: Math.max(prev.maxwait_us, Number(r.maxwait_us) || 0),
    });
  }
  return byDb;
}

/**
 * Fleet-level pooler totals for the platform banner.
 *
 * `max_client_conn` and `max_db_connections` are the two ceilings that actually
 * stop the fleet, and neither is visible from the application side at all.
 */
async function summary() {
  const [poolRows, cfgRows] = await Promise.all([show("SHOW POOLS"), show("SHOW CONFIG")]);
  if (!poolRows) return null;

  const cfg = new Map((cfgRows || []).map((r) => [r.key, r.value]));
  const num = (k) => {
    const v = Number(cfg.get(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  let clActive = 0;
  let clWaiting = 0;
  let svActive = 0;
  let svIdle = 0;
  let maxwait = 0;
  for (const r of poolRows) {
    if (r.database === "pgbouncer") continue;
    clActive += Number(r.cl_active) || 0;
    clWaiting += Number(r.cl_waiting) || 0;
    svActive += Number(r.sv_active) || 0;
    svIdle += Number(r.sv_idle) || 0;
    maxwait = Math.max(maxwait, Number(r.maxwait_us) || 0);
  }

  const maxClient = num("max_client_conn");
  const maxDb = num("max_db_connections");
  const serverUsed = svActive + svIdle;

  return {
    databases: new Set(poolRows.map((r) => r.database).filter((d) => d !== "pgbouncer")).size,
    cl_active: clActive,
    cl_waiting: clWaiting,
    sv_active: svActive,
    sv_idle: svIdle,
    maxwait_us: maxwait,
    max_client_conn: maxClient,
    max_db_connections: maxDb,
    // The two headroom figures that matter, and they constrain different things:
    // client saturation means the app cannot get INTO the pooler; server
    // saturation means the pooler cannot get into Postgres.
    client_utilisation_pct: maxClient ? Math.round((clActive / maxClient) * 1000) / 10 : null,
    server_utilisation_pct: maxDb ? Math.round((serverUsed / maxDb) * 1000) / 10 : null,
  };
}

async function close() {
  if (adminPool) {
    const p = adminPool;
    adminPool = null;
    await p.end().catch(() => {});
  }
}

module.exports = { enabled, pools, summary, close };
