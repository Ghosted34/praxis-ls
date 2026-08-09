/**
 * Host -> tenant resolver (implements the empty stub).
 * Resolves the request Host header to a tenant via the connection registry and
 * attaches req.tenant. Platform/admin hosts are skipped (req.isPlatform).
 * Unknown host -> 404; suspended -> 403; not-yet-live -> 423.
 */
"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const registry = require("../services/tenant/registry.service");
const { AppError } = require("../utils/errors");

const PLATFORM_HOSTS = new Set([
  `admin.${config.APP_BASE_DOMAIN}`,
  `console.${config.APP_BASE_DOMAIN}`,
  `api.${config.APP_BASE_DOMAIN}`,
  config.APP_BASE_DOMAIN,
  "localhost",
]);

// The mail OAuth redirect lands here AFTER the provider's consent screen. Its
// tenant is NOT in the Host: a SINGLE canonical redirect URI serves the whole
// fleet, because Google forbids wildcard redirect URIs and registering every
// tenant subdomain does not scale. The tenant instead rides in the signed
// `state` (mail.service.startOAuth signs slug + user + redirectUri). So on these
// paths we resolve the tenant from that state rather than the host, which lets
// the callback land on the apex / a fixed host and still write the token into
// the correct tenant DB. An unverifiable/absent state falls through to normal
// host resolution (which, on a platform host, is the WRONG_HOST error — the same
// outcome completeOAuth's BAD_STATE would have produced).
const OAUTH_CALLBACK = /\/mail\/oauth\/(?:microsoft|google)\/callback$/;

function slugFromOAuthState(req) {
  if (!OAUTH_CALLBACK.test(req.path)) return null;
  const state = req.query && req.query.state;
  if (!state) return null;
  try {
    const claims = jwt.verify(String(state), config.JWT_ACCESS_SECRET);
    return claims && claims.slug ? String(claims.slug).toLowerCase() : null;
  } catch {
    return null;
  }
}

async function hostTenantResolver(req, res, next) {
  const host = String(req.headers.host || "")
    .toLowerCase()
    .split(":")[0];

  // Dev-only convenience: resolve a tenant on localhost without editing the
  // hosts file. Active only when NODE_ENV=development. A per-request
  // `X-Praxis-Tenant: <slug>` header wins over the `DEV_TENANT_SLUG` env var.
  // The slug is expanded to its registered subdomain and resolved through the
  // normal registry path (same status gates apply below). Never runs in
  // production, so it cannot be used to bypass real host isolation.
  if (config.NODE_ENV === "development") {
    const devSlug = String(req.headers["x-praxis-tenant"] || config.DEV_TENANT_SLUG || "")
      .toLowerCase()
      .trim();
    if (devSlug) {
      const devHost = `${devSlug}.${config.APP_BASE_DOMAIN}`;
      return resolveTenant(req, res, next, devHost);
    }
  }

  // OAuth callback: the tenant is in the signed state, not the host, so this
  // must run BEFORE the platform-host short-circuit — the canonical redirect URI
  // typically lives on the apex / a platform host.
  const stateSlug = slugFromOAuthState(req);
  if (stateSlug) return resolveTenantBySlug(req, res, next, stateSlug);

  if (PLATFORM_HOSTS.has(host)) {
    req.isPlatform = true;
    return next();
  }

  return resolveTenant(req, res, next, host);
}

/**
 * API-F3: these three answered with `res.status(...).json(...)` directly, so
 * they never passed through the error handler and their bodies carried no
 * `request_id`. That made the tenant gate the one part of the stack a customer
 * could not quote a correlation id for — and "unknown workspace" / "workspace
 * suspended" are exactly the failures a customer calls about. Routing them
 * through `next(AppError)` produces the same status and code with the standard
 * envelope, plus the log line the gate never had.
 */
async function resolveTenant(req, res, next, host) {
  try {
    const meta = await registry.resolveByHost(host);
    return applyTenant(req, res, next, meta, `host '${host}'`);
  } catch (err) {
    return next(err);
  }
}

/** Same as resolveTenant, but keyed by slug (OAuth callback — tenant from state). */
async function resolveTenantBySlug(req, res, next, slug) {
  try {
    const meta = await registry.resolveBySlug(slug);
    return applyTenant(req, res, next, meta, `slug '${slug}'`);
  } catch (err) {
    return next(err);
  }
}

/** Apply the resolved tenant meta with the same status gates for either path. */
function applyTenant(req, res, next, meta, label) {
  if (!meta) {
    return next(new AppError("TENANT_NOT_FOUND", `No tenant for ${label}`, 404));
  }
  if (meta.status === "SUSPENDED") {
    return next(new AppError("TENANT_SUSPENDED", "This workspace is suspended.", 403));
  }
  if (meta.status !== "LIVE") {
    return next(new AppError("TENANT_NOT_READY", "This workspace is being provisioned.", 423));
  }
  req.tenant = meta;
  return next();
}

module.exports = { hostTenantResolver, PLATFORM_HOSTS };
