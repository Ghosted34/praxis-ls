/**
 * Platform (company dashboard) login. Mirrors app_user's tenant login shape
 * but against platform.platform_user (0030_platform_ops.sql). That table has no
 * session table, so tokens are STATELESS: login issues a short access token +
 * a longer refresh token (both JWTs), and /refresh mints a fresh pair after
 * re-checking the account is still active. This keeps an admin signed in past
 * the 15-min access TTL instead of being bounced to login on the next request.
 *
 * Tradeoff vs. the tenant side: no DB-backed session, so no remote-kill and no
 * rotation-reuse detection at this tier yet (would need a platform session
 * table). Re-checking is_active on every refresh is the available revocation
 * lever — deactivating the platform_user stops further refreshes.
 */
"use strict";

const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");
const { ROOT_ROLE, CAP_CATALOGUE } = require("../../middleware/platform-auth");
const platformDb = require("./db");

/** The capabilities a role grants (Root Admin → the full catalogue). Included in
 *  the auth payload so the console can hide controls the user can't use. */
async function loadCaps(role) {
  if (role === ROOT_ROLE) return CAP_CATALOGUE.slice();
  const { rows } = await platformDb.query(
    `SELECT rp.capability FROM platform.platform_role r
       JOIN platform.platform_role_permission rp ON rp.role_id = r.role_id
      WHERE r.code = $1`,
    [role],
  );
  return rows.map((r) => r.capability);
}

function signAccess(user) {
  return jwt.sign(
    { sub: user.platform_user_id, typ: "platform", role: user.role },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL },
  );
}

function signRefresh(user) {
  return jwt.sign(
    { sub: user.platform_user_id, typ: "platform_refresh" },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_TTL },
  );
}

function userPayload(u) {
  return {
    platform_user_id: u.platform_user_id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
  };
}

async function login({ email, password }) {
  const { rows } = await platformDb.query(
    `SELECT platform_user_id, email, full_name, role, password_hash, is_active, totp_secret_enc
     FROM platform.platform_user WHERE email = $1`,
    [String(email || "").toLowerCase()],
  );
  const user = rows[0];

  // Same error for "no such user" and "wrong password" — don't leak which.
  const fail = () => {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  };
  if (!user || !user.is_active) return fail();

  const passwordOk = await argon2.verify(user.password_hash, password || "").catch(() => false);
  if (!passwordOk) return fail();

  if (user.totp_secret_enc) {
    // Platform-tier 2FA isn't wired yet either — same "needs a pending-2FA
    // token design decision, not invented here" note as the tenant side
    // (see app_user.service.js). Column exists, verify step doesn't.
    throw new AppError("2FA_NOT_IMPLEMENTED", "2FA step-up is not wired yet", 501);
  }

  await platformDb.query(
    `UPDATE platform.platform_user SET last_login_at = now() WHERE platform_user_id = $1`,
    [user.platform_user_id],
  );

  return {
    access_token: signAccess(user),
    refresh_token: signRefresh(user),
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: { ...userPayload(user), capabilities: await loadCaps(user.role) },
  };
}

/**
 * Exchange a platform refresh token for a fresh access+refresh pair. Stateless:
 * verifies the refresh JWT, then re-loads the platform_user to confirm it's
 * still active (the revocation lever at this tier). Rotates the refresh token.
 */
async function refresh({ refreshToken }) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError("INVALID_TOKEN", "Invalid or expired refresh token", 401);
  }
  if (payload.typ !== "platform_refresh" || !payload.sub) {
    throw new AppError("INVALID_TOKEN", "Not a platform refresh token", 401);
  }
  const { rows } = await platformDb.query(
    `SELECT platform_user_id, email, full_name, role, is_active
     FROM platform.platform_user WHERE platform_user_id = $1`,
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw new AppError("SESSION_REVOKED", "Account no longer active", 401);
  }
  return {
    access_token: signAccess(user),
    refresh_token: signRefresh(user),
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: { ...userPayload(user), capabilities: await loadCaps(user.role) },
  };
}

module.exports = { login, refresh };
