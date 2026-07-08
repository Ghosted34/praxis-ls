/**
 * Platform (company dashboard) login. Mirrors app_user's tenant login shape
 * but against platform.platform_user (0030_platform_ops.sql) — that table
 * has no session/refresh infra defined at all, so this issues a stateless
 * access token only; no refresh token, no remote-kill at this tier yet.
 *
 * Added because there was previously NO way to ever obtain a platform JWT:
 * platform.routes.js already required platformAuth on every single route
 * (chicken-and-egg), and scripts/platform/create-admin.js only ever wrote
 * the password hash to the table — nothing signed a token. Grepped the
 * whole repo for jwt.sign + typ:"platform" before adding this; zero hits.
 * See doc/WORK_DONE.md.
 */
"use strict";

const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");
const platformDb = require("./db");

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

  const accessToken = jwt.sign(
    { sub: user.platform_user_id, typ: "platform", role: user.role },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL },
  );

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: {
      platform_user_id: user.platform_user_id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
  };
}

module.exports = { login };
