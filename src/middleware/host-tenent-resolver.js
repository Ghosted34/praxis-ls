/**
 * Host -> tenant resolver (implements the empty stub).
 * Resolves the request Host header to a tenant via the connection registry and
 * attaches req.tenant. Platform/admin hosts are skipped (req.isPlatform).
 * Unknown host -> 404; suspended -> 403; not-yet-live -> 423.
 */
"use strict";

const { config } = require("../config/env");
const registry = require("../services/tenant/registry.service");

const PLATFORM_HOSTS = new Set([
  `admin.${config.APP_BASE_DOMAIN}`,
  `console.${config.APP_BASE_DOMAIN}`,
  `api.${config.APP_BASE_DOMAIN}`,
  config.APP_BASE_DOMAIN,
  "localhost",
]);

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

  if (PLATFORM_HOSTS.has(host)) {
    req.isPlatform = true;
    return next();
  }

  return resolveTenant(req, res, next, host);
}

async function resolveTenant(req, res, next, host) {
  try {
    const meta = await registry.resolveByHost(host);
    if (!meta) {
      return res.status(404).json({
        error: { code: "TENANT_NOT_FOUND", message: `No tenant for host '${host}'` },
      });
    }
    if (meta.status === "SUSPENDED") {
      return res.status(403).json({
        error: { code: "TENANT_SUSPENDED", message: "This workspace is suspended." },
      });
    }
    if (meta.status !== "LIVE") {
      return res.status(423).json({
        error: { code: "TENANT_NOT_READY", message: "This workspace is being provisioned." },
      });
    }
    req.tenant = meta;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { hostTenantResolver, PLATFORM_HOSTS };
