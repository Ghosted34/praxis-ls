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
const sessionStore = require("../shared/cache/session-store");
const requestContext = require("../config/request-context");
const { logger } = require("../config/logger");
const metrics = require("../shared/observability/metrics");

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

  // Was missing entirely: refresh tokens (typ:"refresh") and, now, 2FA
  // pending tokens (typ:"2fa_pending") are signed with this same secret —
  // without this check either could be replayed here as a real access
  // token. platform-auth.js already had the equivalent check; this side
  // didn't. See doc/WORK_DONE.md.
  if (payload.typ && payload.typ !== "access") {
    throw new AppError("INVALID_TOKEN", "Not an access token", 401);
  }

  if (!req.identityDb) {
    throw new AppError("NO_TENANT_CONTEXT", "tenantContext must run before authMiddleware", 500);
  }

  // Cached auth projection (30 s TTL + event invalidation on deactivate/
  // role change/session revoke) — saves a DB round-trip on every request.
  // Resolved against the env-independent identity schema (req.identityDb) so a
  // LIVE→TEST toggle never bounces the user (accounts live in the live schema).
  const user = await req.identityDb((client) => identityCache.getAuthUser(client, payload.sub));
  if (!user || user.status !== "ACTIVE") {
    // OBS-T4: auth/rbac/tenant middleware contained ZERO logger calls, so there
    // was no failed-authentication record anywhere — a debugging gap and, more
    // seriously, a detection gap: credential stuffing against a multi-tenant
    // ERP would have been entirely invisible.
    metrics.inc("praxis_auth_failures_total", { reason: "user_inactive" }, 1,
      "Authentication failures by reason.");
    logger.warn({ sub: payload.sub, reason: user ? "inactive" : "not_found" }, "authentication rejected");
    throw new AppError("USER_INACTIVE", "User not found or inactive", 401);
  }

  // ── SEC-M1: revocation must actually revoke ────────────────────────────────
  //
  // SEC-C2 put `sid` in the access token so logout could revoke the session
  // without the client naming it. Nothing then CHECKED it here, so killing a
  // session, hitting the idle timeout or tripping refresh-reuse detection
  // blocked the next refresh and left the already-issued access token working
  // for its remaining TTL. "Revoke this session now" did not mean now — which
  // is exactly what the security screen implies it means, and what an incident
  // responder would rely on while containing a compromised account.
  //
  // WHY IT IS A FALLBACK AND NOT A LOOKUP. Redis is a cache; `killed_at` in
  // Postgres is the record. A Redis restart or eviction empties the index while
  // every session in it is still valid, so "absent from Redis" must mean "go
  // and ask", never "reject". The happy path is one Redis EXISTS and no
  // database round-trip; a cold or missing index costs one indexed query.
  //
  // FAILS OPEN on an infrastructure error, LOUDLY. If both Redis and the
  // identity database are unreachable we cannot distinguish a revoked session
  // from an unreachable one, and refusing every request would convert a cache
  // outage into a total sign-out. The 15-minute window this closes is not worth
  // that, so the error is logged and counted instead of thrown.
  //
  // Tokens minted before SEC-C2 carry no `sid`; they are let through and expire
  // on their own, which is the same degradation logout already accepts.
  if (payload.sid) {
    let live = await sessionStore.isSessionActive(payload.sid);
    if (live !== true) {
      try {
        const row = await req.identityDb((client) =>
          client.query(
            "SELECT killed_at FROM user_session WHERE session_id = $1",
            [payload.sid],
          ).then((r) => r.rows[0] || null),
        );
        // No row is not "unknown": `sid` is only ever minted alongside a
        // user_session row, so its absence means the session is gone.
        live = row ? row.killed_at === null : false;
      } catch (err) {
        metrics.inc("praxis_auth_failures_total", { reason: "session_check_unavailable" }, 1,
          "Authentication failures by reason.");
        logger.error({ sid: payload.sid, err }, "session revocation check unavailable — allowing request");
        live = true;
      }
    }
    if (!live) {
      metrics.inc("praxis_auth_failures_total", { reason: "session_revoked" }, 1,
        "Authentication failures by reason.");
      logger.warn({ sub: payload.sub, sid: payload.sid }, "authentication rejected: session revoked");
      throw new AppError("SESSION_REVOKED", "This session has been ended", 401);
    }
  }

  req.user = {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    employee_id: user.employee_id || null,
    avatar_ref: user.avatar_ref || null,
    role_ids: user.role_ids || [],
    is_ceo: user.is_ceo === true,
    jwt_iat: payload.iat,
    jwt_jti: payload.jti,
    // SEC-C2: the session this token belongs to, so logout can revoke it without
    // the client having to tell us. Undefined on tokens issued before that
    // shipped; logout degrades rather than erroring.
    session_id: payload.sid || null,
  };

  // OBS-L3. `tenantContext` binds the ambient request-context BEFORE auth runs,
  // so the userId it captured was always null — every log line would have
  // carried a tenant and an empty user. The AsyncLocalStorage store is a live
  // object for the remainder of the request, so filling it in here means the
  // logger mixin (config/logger.js) and every downstream `SET LOCAL
  // app.current_user_id` see the real actor.
  const ctx = requestContext.get();
  if (ctx) ctx.userId = user.user_id;

  return next();
}

module.exports = { authMiddleware };
