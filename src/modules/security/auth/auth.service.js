/**
 * Login / session issuance. This module didn't exist before — there was no
 * way to obtain a JWT anywhere in the codebase (checked: no jwt.sign() call
 * outside this file; auth.js/rbac.js only ever verified tokens nobody could
 * mint). See doc/RBAC_SECURITY_KICKOFF.md ("Work Done Already").
 *
 * Scope kept deliberately small for a starter module:
 *   - login: real (Argon2id verify, session row, access+refresh JWT).
 *   - refresh: real (verifies the refresh JWT + that its session is alive).
 *   - logout: real (kills the session, invalidates the identity cache).
 *   - verifyTotp (2FA step-up): STUBBED — needs a decision on how a
 *     "password OK, 2FA pending" intermediate state is represented (a
 *     short-lived pending-2FA token is the usual pattern) plus wiring
 *     encryption.service.js to decrypt `app_user.totp_secret_enc` and
 *     otplib to verify the code. Left as a follow-up, not invented here.
 */
"use strict";

const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");

const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const identityCache = require("../../../shared/cache/identity-cache");
const repo = require("./auth.repo");
const events = require("./auth.events");

function signAccessToken({ userId, jti }) {
  return jwt.sign({ sub: userId, jti, typ: "access" }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL,
  });
}

function signRefreshToken({ userId, sessionId, jti }) {
  return jwt.sign(
    { sub: userId, sid: sessionId, jti, typ: "refresh" },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_TTL },
  );
}

async function login(client, { email, password, ip, userAgent, environment }) {
  const user = await repo.findByEmail(client, String(email || "").toLowerCase());

  // Same error for "no such user" and "wrong password" — don't leak which.
  const fail = async (reason) => {
    if (user) await repo.recordLoginFailure(client, user.user_id);
    await emitEvent(client, {
      eventTypeKey: events.LOGIN_FAILED,
      moduleKey: events.MODULE,
      entityRef: `app_user:${user ? user.user_id : "unknown"}`,
      payload: { email, reason },
    });
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  };

  if (!user) return fail("no_such_user");
  if (user.status !== "ACTIVE") {
    throw new AppError("USER_INACTIVE", "Account is suspended or locked", 401);
  }

  const passwordOk = await argon2.verify(user.password_hash, password || "").catch(() => false);
  if (!passwordOk) return fail("bad_password");

  if (user.is_2fa_enabled) {
    // TODO: return a short-lived pending-2FA token instead of full tokens,
    // and add POST /auth/2fa/verify to exchange it for the real pair.
    throw new AppError("2FA_NOT_IMPLEMENTED", "2FA step-up is not wired yet", 501);
  }

  await repo.recordLoginSuccess(client, user.user_id);
  const sessionId = await repo.createSession(client, {
    userId: user.user_id,
    ip,
    userAgent,
    environment,
  });

  const jti = uuid();
  const accessToken = signAccessToken({ userId: user.user_id, jti });
  const refreshToken = signRefreshToken({ userId: user.user_id, sessionId, jti: uuid() });

  await identityCache.invalidateUser(user.user_id); // drop any stale cached (e.g. inactive) entry
  await emitEvent(client, {
    eventTypeKey: events.LOGIN_SUCCEEDED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${user.user_id}`,
    actorUserId: user.user_id,
  });
  await audit(client, {
    actorUserId: user.user_id,
    action: events.LOGIN_SUCCEEDED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${user.user_id}`,
    ip,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: { user_id: user.user_id, email: user.email, display_name: user.full_name },
  };
}

async function refresh(client, { refreshToken }) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError("INVALID_TOKEN", "Invalid or expired refresh token", 401);
  }
  if (payload.typ !== "refresh" || !payload.sid) {
    throw new AppError("INVALID_TOKEN", "Not a refresh token", 401);
  }

  const session = await repo.getActiveSession(client, payload.sid);
  if (!session || session.killed_at || session.user_id !== payload.sub) {
    throw new AppError("SESSION_REVOKED", "Session no longer active", 401);
  }

  await repo.touchSession(client, payload.sid);
  const accessToken = signAccessToken({ userId: payload.sub, jti: uuid() });

  await emitEvent(client, {
    eventTypeKey: events.TOKEN_REFRESHED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${payload.sub}`,
    actorUserId: payload.sub,
  });

  return { access_token: accessToken, token_type: "Bearer", expires_in: config.JWT_ACCESS_TTL };
}

async function logout(client, { actor, sessionId }) {
  if (sessionId) await repo.killSession(client, sessionId, actor.user_id);
  await identityCache.invalidateUser(actor.user_id);
  await emitEvent(client, {
    eventTypeKey: events.LOGGED_OUT,
    moduleKey: events.MODULE,
    entityRef: `app_user:${actor.user_id}`,
    actorUserId: actor.user_id,
  });
  await audit(client, {
    actorUserId: actor.user_id,
    action: events.LOGGED_OUT,
    moduleKey: events.MODULE,
    entityRef: `app_user:${actor.user_id}`,
  });
  return { logged_out: true };
}

module.exports = { login, refresh, logout };
