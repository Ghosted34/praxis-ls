/**
 * Tenant request context (implements the empty stub). Runs after
 * hostTenantResolver (req.tenant) and after auth (optional req.user). Picks the
 * environment (sandbox only when NOT live and X-Praxis-Env: sandbox), binds an
 * ambient request-context, and exposes req.tenantDb(fn).
 */
"use strict";

const requestContext = require("../config/request-context");
const registry = require("../services/tenant/registry.service");
const { AppError } = require("../utils/errors");

function tenantContext(req, res, next) {
  if (!req.tenant) {
    // API-F4. Two different causes reached this line and both answered 500.
    //
    // `req.isPlatform` means hostTenantResolver DID run and deliberately did
    // not set a tenant, because the request arrived on a platform host
    // (localhost, api.*, admin.*, the apex). Asking the tenant API for tenant
    // data over the platform host is a CLIENT error — the wrong Host header —
    // and it is a documented footgun: postman/README.md warns that "localhost
    // is the platform host". Answering 500 told the caller the server was
    // broken when the request was.
    //
    // The message names the fix, because the whole reason this is worth a
    // finding is that the 500 gave the caller nowhere to go.
    if (req.isPlatform) {
      return next(new AppError(
        "WRONG_HOST",
        "This is the tenant API, and the request arrived on a platform host. "
        + "Send it to the tenant's own host (e.g. <slug>.<app-domain>); "
        + "in development, set X-Praxis-Tenant: <slug>.",
        400,
      ));
    }
    // No tenant AND not a platform host means the resolver never ran at all —
    // a misordered middleware chain, which is a programming error and stays a
    // loud, logged, reported 500 (API-F3).
    return next(new AppError("NO_TENANT_CONTEXT", "hostTenantResolver must run first", 500));
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

  /** Point the shared lease at an environment's schema, acquiring it first
   *  time. `registry.acquire` owns the SET on checkout, so a later switch is
   *  the one place that repeats it. */
  async function pin(wantEnv) {
    if (!lease) {
      lease = await registry.acquire(req.tenant, wantEnv);
      leaseEnv = wantEnv;
      return;
    }
    if (leaseEnv === wantEnv) return;
    const schema =
      wantEnv === "sandbox"
        ? req.tenant.sandbox_schema || "sandbox"
        : req.tenant.live_schema || "live";
    await lease.query(`SET search_path = ${schema}, public`);
    lease[registry.SCHEMA] = schema;
    leaseEnv = wantEnv;
  }

  /**
   * Run `fn` with the connection pinned to `wantEnv`, then PUT THE PIN BACK.
   *
   * The restore is the whole point, and it is a bug fix. `tenantDb` and
   * `identityDb` share one connection, and switching between them re-binds
   * `search_path` — so a NESTED call left the connection pointing somewhere the
   * outer callback did not expect:
   *
   *     req.tenantDb(async (c) =>                       // sandbox
   *       service.update(c, { patch: await withDepartment(req, body) }))
   *                              ^ req.identityDb → SET search_path = live
   *                                …and `service.update` then ran on LIVE.
   *
   * Under sandbox that made `PATCH /vacancies/:id` answer "Vacancy not found"
   * (it looked in live for a sandbox row) and, far worse, made `POST` on the
   * same controllers INSERT a sandbox session's row into the LIVE schema.
   * Employees and vacancies both took that path.
   *
   * Restoring costs one extra `SET` per nested call and makes the nesting safe
   * everywhere rather than in the four handlers that happened to be found. The
   * call sites were also unnested, so this is the belt and that is the braces.
   */
  async function withPinned(wantEnv, fn) {
    if (released) {
      // Called after releaseDb() or after the response finished. Fall back to
      // a plain checkout rather than throwing: a late audit or metrics write
      // failing is worse than one extra connection.
      return registry.withTenantConnection(req.tenant, wantEnv, fn);
    }
    const outerEnv = lease ? leaseEnv : null;
    await pin(wantEnv);
    try {
      return await fn(lease);
    } finally {
      // Only when this call actually moved the pin, and only while the lease is
      // still ours — a handler that released mid-flight has nothing to restore.
      if (outerEnv && outerEnv !== wantEnv && !released && lease) {
        await pin(outerEnv);
      }
    }
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
  /**
   * Business data in a NAMED environment, rather than the one the request asked
   * for. One caller: the public careers page, which has no session and no
   * `X-Praxis-Env` to read, so it finds the environment a careers token belongs
   * to and then stays in it. Everything else must use `req.tenantDb` — the
   * environment a request runs in is the header's decision, not a handler's.
   */
  req.tenantDbIn = (wantEnv, fn) => withPinned(wantEnv === "sandbox" ? "sandbox" : "live", fn);

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
