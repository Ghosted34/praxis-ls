#!/usr/bin/env node
/**
 * Tenant smoke test — INCIDENT 2026-08-12.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 12 August 2026 every tenant login failed with
 * `Connection terminated due to connection timeout`, and `deploy.sh`'s readiness
 * gate passed the whole way through. It could not have done otherwise:
 * `/api/health/ready` probes the PLATFORM database and Redis, and both were
 * healthy. The broken thing was the tenant connection path — resolving a tenant,
 * opening a pool against its own database, checking out a connection — which no
 * deploy-time check touched.
 *
 * A health check that never touches a tenant cannot see a tenant outage. This
 * script closes that gap by exercising the real path end to end, using the same
 * registry, the same credential resolution and the same pool the application
 * uses, so it fails for the same reasons the application would.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not post credentials to the login route. That would need a real user
 * and a real password in the deploy environment, and a failure would then be
 * ambiguous between "the tenant path is broken" and "the password changed". The
 * connection path is the part that broke and the part worth gating on.
 *
 * EXIT CODES
 *   0  the tenant was resolved, a connection acquired, and a query answered
 *   1  the tenant path failed — the deploy should not be considered good
 *   2  usage error (no slug given, tenant not in the registry)
 *
 * USAGE
 *   node scripts/ops/tenant-smoke.js --slug=smartls
 *   node scripts/ops/tenant-smoke.js --slug=smartls --timeout-ms=5000
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const args = process.argv.slice(2);
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const SLUG = argOf("slug");

// Default to the application's own acquire timeout. The point is to fail where a
// user would fail, not to be more patient than the product is.
const { config } = require("../../src/config/env");
const TIMEOUT_MS = Number(argOf("timeout-ms") || config.TENANT_POOL_ACQUIRE_TIMEOUT_MS || 5000);

function fail(code, msg, detail) {
  console.error(`tenant-smoke: ${msg}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(code);
}

async function main() {
  if (!SLUG) fail(2, "no --slug given", "usage: tenant-smoke.js --slug=<tenant>");

  const registry = require("../../src/services/tenant/registry.service");

  const started = Date.now();

  const meta = await registry.resolveBySlug(SLUG);
  if (!meta) {
    fail(2, `tenant "${SLUG}" is not in the registry`, "check TENANT_SMOKE_SLUG names a provisioned tenant");
  }
  const resolvedMs = Date.now() - started;

  // The actual assertion: acquire a connection from THIS tenant's pool and use
  // it. Wrapped in a timeout because the 12 August failure was a hang, not an
  // error — an unbounded await would have made this script hang alongside the
  // outage instead of reporting it.
  const work = registry.withTenantConnection(meta, "live", async (client) => {
    // current_schema() is asserted, not merely reported.
    //
    // It is the one thing a pooled connection can get wrong SILENTLY. The app
    // ships its schema as a startup parameter when talking to Postgres directly
    // and as a role default when talking through PgBouncer; if either is missing
    // the connection still opens, still authenticates, and then resolves every
    // unqualified table name against `public` — where none of them are. That is
    // not a connection error, it is a wrong answer, and nothing else in this
    // script would notice.
    const { rows } = await client.query(
      "SELECT current_database() AS db, current_user AS role, current_schema() AS schema",
    );
    return rows[0];
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`tenant connection exceeded ${TIMEOUT_MS}ms`), { code: "SMOKE_TIMEOUT" })),
      TIMEOUT_MS,
    );
  });

  let row;
  try {
    row = await Promise.race([work, timeout]);
  } catch (err) {
    if (err && err.code === "SMOKE_TIMEOUT") {
      fail(
        1,
        `tenant "${SLUG}" did not yield a connection within ${TIMEOUT_MS}ms`,
        "this is the 2026-08-12 failure shape: pool acquisition timing out rather than erroring. " +
          "Check the connection budget (src/config/connection-budget.js) and pg_stat_activity.",
      );
    }
    fail(1, `tenant "${SLUG}" could not be served`, err && err.message);
  } finally {
    clearTimeout(timer);
  }

  // A connection on the wrong schema is a FAILURE, not a note. See above.
  if (row.schema !== "live") {
    fail(
      1,
      `tenant "${SLUG}" connected but landed on schema "${row.schema}", expected "live"`,
      "Every tenant table is in `live`; on `public` the connection works and every query fails. " +
        "Direct to Postgres this comes from the pool's startup parameter; through PgBouncer it comes " +
        "from `ALTER ROLE ... IN DATABASE ... SET search_path`, applied by ensureTenantRole() — a " +
        "tenant provisioned before that ran needs `npm run db:creds:backfill`.",
    );
  }

  const totalMs = Date.now() - started;
  console.warn(
    `tenant-smoke OK: ${SLUG} → db=${row.db} role=${row.role} schema=${row.schema}` +
      `${config.TENANT_DB_POOLER_HOST ? ` via pooler ${config.TENANT_DB_POOLER_HOST}` : " direct"} ` +
      `(resolve ${resolvedMs}ms, total ${totalMs}ms, budget ${TIMEOUT_MS}ms)`,
  );

  // Close pools so the script exits rather than hanging on an open handle.
  try {
    await registry.closeAll();
  } catch {
    /* best effort — the assertion has already passed */
  }
  process.exit(0);
}

main().catch((err) => {
  fail(1, "tenant smoke test threw", err && err.stack ? err.stack : String(err));
});
