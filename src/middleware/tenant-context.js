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
  req.tenantDb = (fn) => registry.withTenantConnection(req.tenant, env, fn);
  // Identity is env-independent ("same you, sandbox data"): auth, sessions,
  // devices, 2FA, users and the RBAC grant matrix always resolve against the
  // LIVE/identity schema regardless of X-Praxis-Env, so flipping to Test only
  // sandboxes *business* data — it never logs the user out. Only business
  // reads/writes go through req.tenantDb(env). See doc/SESSION_HANDOFF.md
  // (LIVE/TEST toggle) + doc/DB_ARCHITECTURE.md.
  req.identityDb = (fn) => registry.withTenantConnection(req.tenant, "live", fn);

  const ctx = {
    tenant: req.tenant.slug,
    userId: req.user ? req.user.user_id : null,
    env,
  };
  return requestContext.run(ctx, () => next());
}

module.exports = { tenantContext };
