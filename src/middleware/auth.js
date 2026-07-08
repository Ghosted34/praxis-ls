/**
 * Authentication middleware.
 *
 * Expects `Authorization: Bearer <jwt>` on protected routes. Must run AFTER
 * `tenantContext` (needs `req.tenantDb` — `app_user`/`role` are tenant
 * tables, not platform tables). Verifies, loads user, attaches req.user.
 * 401 on failure.
 *
 * The verified user is then a starting point for:
 *   - req.user.user_id            uuid
 *   - req.user.email
 *   - req.user.role_ids           []
 *   - req.user.is_ceo             boolean  (role.code = 'CEO' — bypasses RBAC)
 *
 * Fixed vs. the original: this previously read `config.JWT_SECRET` (not a
 * defined env var — only JWT_ACCESS_SECRET/JWT_REFRESH_SECRET exist, see
 * src/config/env.js) and called `identityCache.getAuthUser(payload.sub)`
 * with no tenant client, and identity-cache.js didn't exist at all. Also
 * dropped `available_businesses`/`default_business_key` — leftover fields
 * from a prior multi-brand storefront project; Praxis scopes users by
 * `corporate_entity`/`scope`, not "business". See
 * doc/RBAC_SECURITY_KICKOFF.md.
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");
const identityCache = require("../shared/cache/identity-cache");

async function authMiddleware(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("AUTH_REQUIRED", "Authorization header missing", 401);
  }

  const token = header.slice("Bearer ".length).trim();
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new AppError("TOKEN_EXPIRED", "Access token expired", 401);
    }
    throw new AppError("INVALID_TOKEN", "Invalid access token", 401);
  }

  if (!req.tenantDb) {
    throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before authMiddleware", 500);
  }

  // Cached auth projection (30 s TTL + event invalidation on deactivate/
  // role change/session revoke) — saves a DB round-trip on every request.
  const user = await req.tenantDb((client) => identityCache.getAuthUser(client, payload.sub));
  if (!user || user.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "User not found or inactive", 401);
  }

  req.user = {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    role_ids: user.role_ids || [],
    is_ceo: user.is_ceo === true,
    jwt_iat: payload.iat,
    jwt_jti: payload.jti,
  };

  return next();
}

module.exports = { authMiddleware };
