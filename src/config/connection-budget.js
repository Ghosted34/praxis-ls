/**
 * Connection budget check — INCIDENT 2026-08-12.
 *
 * THE FAILURE THIS EXISTS TO PREVENT
 * ----------------------------------
 * On 12 August 2026 every tenant login began failing with
 * `Connection terminated due to connection timeout`. Nothing was misconfigured
 * in a way anyone could see: each individual setting was reasonable. What nobody
 * had ever done was ADD THEM UP.
 *
 *     DB_POOL_MAX 10                                      =  10 per process
 *     TENANT_POOL_MAX 8 × TENANT_POOL_CACHE_MAX 24         = 192 per process
 *     × 3 processes (api, api-standby, worker)             = 606 total
 *
 * against a Postgres `max_connections` that `docker-compose.yml` never set — so
 * the default, 100. A ~6× oversubscription, survivable only for as long as idle
 * tenants never had pools. The Kaizen ops health collector then started touching
 * every tenant every five minutes, materialising exactly the pools the ceiling
 * assumed would stay cold, and the arithmetic came due.
 *
 * The repo already refuses to start Redis without a password, and refuses to
 * start PgBouncer without one, on the same reasoning: a configuration that looks
 * fine and is not should fail at boot, in the open, rather than at 3am under
 * load. The database connection budget is the larger of those risks and had no
 * such check. This is it.
 *
 * WHY IT WARNS BY DEFAULT
 * -----------------------
 * `SHOW max_connections` reports the SERVER's limit. A deployment fronted by
 * PgBouncer legitimately oversubscribes it — that is the entire point of a
 * pooler — so refusing to start would be wrong there. The check therefore knows
 * about `TENANT_DB_POOLER_HOST` and measures the pooler's ceiling instead when
 * one is in use. `enforce` is available for deployments that want the harder
 * guarantee; `warn` is the default because a false negative that stops a
 * deployment is worse than a loud line in the log that stops a person.
 *
 * WHERE IT RUNS
 * -------------
 * Once, at boot, from `server.js` and from the worker entrypoint — after the
 * platform pool can answer a query and before anything begins serving.
 */
"use strict";

const { config } = require("./env");
const { logger } = require("./logger");

/**
 * The per-process ceiling: the most Postgres connections this process could hold
 * if every tenant pool in the LRU were simultaneously at its maximum.
 *
 * This is deliberately the WORST case, not the expected one. The expected case
 * was fine on 12 August; it was the worst case that arrived.
 */
function perProcessCeiling() {
  const platform = Number(config.DB_POOL_MAX) || 0;
  // The background pool is separate from the serving pool precisely so ops work
  // cannot starve a request — but it is still real connections against the same
  // server, so it counts here. A budget that omits the pool added to fix the last
  // incident is how the next one starts.
  const ops = Number(config.OPS_POOL_MAX) || 0;
  const tenants =
    (Number(config.TENANT_POOL_MAX) || 0) * (Number(config.TENANT_POOL_CACHE_MAX) || 0);
  return { platform, ops, tenants, total: platform + ops + tenants };
}

/** Read the server's limit. Returns null when it cannot be determined. */
async function serverLimit(db) {
  try {
    const { rows } = await db.query("SHOW max_connections");
    const n = Number(rows[0] && rows[0].max_connections);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Compute the budget and report on it.
 *
 * Returns `{ ok, ceiling, limit, allowed, reason }` so callers (and tests) can
 * assert on the numbers rather than on a log line.
 */
async function evaluate(db) {
  const mode = config.DB_BUDGET_CHECK || "warn";
  if (mode === "off") return { ok: true, skipped: "DB_BUDGET_CHECK=off" };

  const per = perProcessCeiling();
  const processes = Math.max(1, Number(config.DB_BUDGET_PROCESSES) || 1);
  const ceiling = per.total * processes;

  const pooled = Boolean(config.TENANT_DB_POOLER_HOST);
  const limit = await serverLimit(db);

  if (limit === null) {
    return {
      ok: true,
      skipped: "max_connections unreadable",
      ceiling,
      pooled,
    };
  }

  // With a transaction pooler in front, the app's client-side ceiling is
  // supposed to exceed the server's — the pooler is what reconciles them. The
  // number that matters there is PGBOUNCER_MAX_DB_CONNECTIONS, which this
  // process does not read (it belongs to the pooler container), so the check
  // reports rather than judges.
  if (pooled) {
    return {
      ok: true,
      pooled: true,
      ceiling,
      limit,
      reason:
        "a pooler is in front of Postgres, so the app ceiling may exceed max_connections by design — " +
        "the binding limit is PGBOUNCER_MAX_DB_CONNECTIONS",
    };
  }

  const headroomPct = Math.min(90, Math.max(0, Number(config.DB_BUDGET_HEADROOM_PCT) || 0));
  const allowed = Math.floor(limit * (1 - headroomPct / 100));
  const ok = ceiling <= allowed;

  return { ok, ceiling, limit, allowed, headroomPct, processes, per, pooled: false };
}

/** Human-readable arithmetic, so a failure explains itself without the source. */
function describe(r) {
  return [
    `configured ceiling ${r.ceiling} connections`,
    `(${r.per.platform} platform + ${r.per.ops} ops + ${r.per.tenants} tenant pools) × ${r.processes} processes`,
    `vs max_connections ${r.limit}`,
    `less ${r.headroomPct}% headroom = ${r.allowed} usable`,
  ].join(" ");
}

/**
 * Run the check at boot.
 *
 * Throws only under `DB_BUDGET_CHECK=enforce`; otherwise the process starts and
 * the operator gets a line they cannot miss.
 */
async function check(db) {
  const r = await evaluate(db);

  if (r.skipped) {
    logger.debug({ ...r }, "connection budget check skipped");
    return r;
  }
  if (r.pooled) {
    logger.info({ ceiling: r.ceiling, limit: r.limit }, `connection budget: ${r.reason}`);
    return r;
  }
  if (r.ok) {
    logger.info(
      { ceiling: r.ceiling, limit: r.limit, allowed: r.allowed },
      "connection budget OK",
    );
    return r;
  }

  const msg =
    `CONNECTION BUDGET EXCEEDED — ${describe(r)}. ` +
    "Under load this presents as tenant requests timing out in pool acquisition, not as a " +
    "connection error, which is what made the 2026-08-12 outage slow to diagnose. " +
    "Fix by raising Postgres max_connections, lowering TENANT_POOL_MAX / TENANT_POOL_CACHE_MAX, " +
    "or putting PgBouncer in front (TENANT_DB_POOLER_HOST).";

  if ((config.DB_BUDGET_CHECK || "warn") === "enforce") {
    logger.fatal({ ...r }, msg);
    const err = new Error(msg);
    err.code = "DB_BUDGET_EXCEEDED";
    throw err;
  }
  logger.error({ ...r }, msg);
  return r;
}

module.exports = { check, evaluate, perProcessCeiling, describe };
