/**
 * Tenant request context (implements the empty stub). Runs after
 * hostTenantResolver (req.tenant) and after auth (optional req.user). Picks the
 * environment (sandbox only when NOT live and X-Praxis-Env: sandbox), binds an
 * ambient request-context, and exposes req.tenantDb(fn).
 */
"use strict";

const requestContext = require("../config/request-context");
const registry = require("../services/tenant/registry.service");

function tenantContext(req, res, next) {
  if (!req.tenant) {
    return res.status(500).json({
      error: { code: "NO_TENANT_CONTEXT", message: "hostTenantResolver must run first" },
    });
  }
  const requested = String(req.headers["x-praxis-env"] || "").toLowerCase();
  const env = !req.tenant.is_live && requested === "sandbox" ? "sandbox" : "live";

  req.env = env;

  /**
   * PERF S2 — one connection per request, not three.
   *
   * Measured: `auth.js` takes a connection, `rbac.js` takes another, the
   * controller takes a third. Each pays `pool.connect()` plus a
   * `SET search_path` round-trip, so effective concurrency was
   * `pool_max / 3` ≈ 2.7 in-flight requests per tenant, and throughput
   * plateaued at ~1,200 req/s while p50 grew 14× under load — textbook
   * queueing on a saturated pool.
   *
   * The connection is acquired LAZILY, on first use, so a request that never
   * touches the database (a 404, a static asset, a health probe) holds
   * nothing. It is released when the response finishes.
   *
   * TWO CONSEQUENCES WORTH BEING EXPLICIT ABOUT:
   *
   * 1. `tenantDb` and `identityDb` now share one connection. Under LIVE they
   *    already wanted the same schema, so this costs nothing. Under sandbox
   *    they differ, and `registry.acquire` re-binds the search_path on each
   *    switch — one SET where there used to be a checkout AND a SET.
   *
   * 2. Two db calls in the same request are no longer isolated from each
   *    other. That is a fix, not a regression: code that assumed otherwise was
   *    already relying on two separate connections silently being two separate
   *    transactions. Verified before making this change that nothing runs
   *    `req.tenantDb` calls concurrently (no Promise.all over them anywhere in
   *    src/), so the serialisation `pg` imposes on a shared client changes no
   *    existing behaviour.
   *
   * A long-running handler now holds its connection for the whole response.
   * `req.releaseDb()` is the escape hatch for a handler that is done with the
   * database and still has work to do — streaming a large export, say.
   */
  let lease = null; // { client, schema }
  let leaseEnv = null;
  let released = false;

  async function withPinned(wantEnv, fn) {
    if (released) {
      // Called after releaseDb() or after the response finished. Fall back to
      // a plain checkout rather than throwing: a late audit or metrics write
      // failing is worse than one extra connection.
      return registry.withTenantConnection(req.tenant, wantEnv, fn);
    }
    if (!lease) {
      lease = await registry.acquire(req.tenant, wantEnv);
      leaseEnv = wantEnv;
    } else if (leaseEnv !== wantEnv) {
      // Same connection, different schema. registry.acquire owns the SET, so
      // go through it rather than duplicating the search_path string here.
      const schema =
        wantEnv === "sandbox"
          ? req.tenant.sandbox_schema || "sandbox"
          : req.tenant.live_schema || "live";
      await lease.query(`SET search_path = ${schema}, public`);
      lease[registry.SCHEMA] = schema;
      leaseEnv = wantEnv;
    }
    return fn(lease);
  }

  req.releaseDb = () => {
    released = true;
    if (lease) {
      lease.release();
      lease = null;
    }
  };
  // 'close' as well as 'finish': an aborted connection never fires 'finish',
  // and a leaked pooled client is how a pool dies.
  res.on("finish", req.releaseDb);
  res.on("close", req.releaseDb);

  req.tenantDb = (fn) => withPinned(env, fn);
  // Identity is env-independent ("same you, sandbox data"): auth, sessions,
  // devices, 2FA, users and the RBAC grant matrix always resolve against the
  // LIVE/identity schema regardless of X-Praxis-Env, so flipping to Test only
  // sandboxes *business* data — it never logs the user out. Only business
  // reads/writes go through req.tenantDb(env). See doc/SESSION_HANDOFF.md
  // (LIVE/TEST toggle) + doc/DB_ARCHITECTURE.md.
  req.identityDb = (fn) => withPinned("live", fn);

  const ctx = {
    tenant: req.tenant.slug,
    userId: req.user ? req.user.user_id : null,
    // OBS-E3: the correlation id was minted by requestIdMiddleware and then
    // thrown away — it reached the response header and nothing else. Carrying
    // it in the ambient context is what lets a log line, an error report and a
    // background job all name the same request.
    requestId: req.request_id || null,
    env,
  };
  return requestContext.run(ctx, () => next());
}

module.exports = { tenantContext };
