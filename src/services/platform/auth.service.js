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

const crypto = require("crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
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

/**
 * SEC-M6 — the platform refresh TTL is its own, and it is short.
 *
 * This inherited the shared 30-day default, on a tier that provisions and wipes
 * tenant databases. Thirty days is a reasonable window for a warehouse clerk's
 * phone; it is not a reasonable window for a credential that administers every
 * customer. Seven days, overridable, and deliberately not the tenant value.
 */
const PLATFORM_REFRESH_TTL = process.env.PLATFORM_REFRESH_TTL || "7d";

/**
 * The same TTL as a Postgres interval, for `expires_at`.
 *
 * Two consumers want this value in two syntaxes: `jsonwebtoken` takes `7d`,
 * Postgres wants `7 days`. Converted explicitly and VALIDATED AT LOAD rather
 * than interpolated hopefully — an unconvertible value would otherwise reach
 * the database as a malformed interval and fail every platform LOGIN at
 * runtime, which is the worst place to discover a config typo. A naive
 * `replace(/^(\d+)d$/)` silently passed `12h` through unchanged; this rejects
 * what it cannot convert, at boot, with the fix in the message.
 */
const TTL_UNITS = { s: "seconds", m: "minutes", h: "hours", d: "days", w: "weeks" };
const PLATFORM_REFRESH_INTERVAL = (() => {
  const m = String(PLATFORM_REFRESH_TTL).trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!m) {
    throw new Error(
      `PLATFORM_REFRESH_TTL="${PLATFORM_REFRESH_TTL}" is not a supported duration. `
      + "Use <number><s|m|h|d|w>, e.g. 7d or 12h.",
    );
  }
  return `${m[1]} ${TTL_UNITS[m[2].toLowerCase()]}`;
})();

/**
 * The refresh token now carries `sid` and `jti`, so it names the session row it
 * belongs to. Without those, a refresh token is a bearer credential with no
 * identity beyond its subject — which is exactly why revocation could not work
 * at this tier.
 */
function signRefresh(user, { sessionId, jti }) {
  return jwt.sign(
    { sub: user.platform_user_id, typ: "platform_refresh", sid: sessionId, jti },
    config.JWT_REFRESH_SECRET,
    { expiresIn: PLATFORM_REFRESH_TTL },
  );
}

/** Open a session row and return the refresh token bound to it. */
async function openSession(user, { ip = null, userAgent = null } = {}) {
  const jti = crypto.randomUUID();
  const { rows } = await platformDb.query(
    `INSERT INTO platform.platform_session
       (platform_user_id, refresh_jti, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + $3::interval, $4, $5)
     RETURNING session_id`,
    [user.platform_user_id, jti, PLATFORM_REFRESH_INTERVAL, ip, userAgent],
  );
  const sessionId = rows[0].session_id;
  return { sessionId, refreshToken: signRefresh(user, { sessionId, jti }) };
}

/**
 * Kill a session and everything downstream of it in the rotation chain.
 *
 * Used on reuse detection. Killing only the presented session would be
 * pointless: the attacker and the legitimate user are both holding tokens for
 * that chain, and the one that is still valid is whichever rotated last.
 */
async function killChain(sessionId, killedBy = null) {
  await platformDb.query(
    `WITH RECURSIVE chain AS (
       SELECT session_id, replaced_by FROM platform.platform_session WHERE session_id = $1
       UNION
       SELECT s.session_id, s.replaced_by
         FROM platform.platform_session s
         JOIN chain c ON s.session_id = c.replaced_by
     )
     UPDATE platform.platform_session t
        SET killed_at = now(), killed_by = $2
       FROM chain
      WHERE t.session_id = chain.session_id AND t.killed_at IS NULL`,
    [sessionId, killedBy],
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

// `ip` / `userAgent` are optional and recorded on the session row (SEC-M6), so
// "which of these is mine?" is answerable on a tier that administers every
// tenant. Optional so existing callers keep working unchanged.
async function login({ email, password, ip = null, userAgent = null }) {
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

  const { refreshToken } = await openSession(user, { ip, userAgent });
  return {
    access_token: signAccess(user),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: { ...userPayload(user), capabilities: await loadCaps(user.role) },
  };
}

/**
 * Exchange a platform refresh token for a fresh access+refresh pair.
 *
 * SEC-M6 — no longer stateless. It resolves the session named by the token and
 * refuses a killed, expired or ALREADY-ROTATED one, then rotates: the presented
 * session is marked `replaced_by` the new one.
 *
 * REUSE DETECTION is the part that earns the table. A refresh arriving for a
 * session that has already been replaced means that token was captured — the
 * legitimate holder rotated past it. Refusing just this request would leave the
 * attacker's newer token working, so the whole chain is killed and both parties
 * are forced back to login. That is the behaviour the tenant tier has had since
 * SEC-C2; this tier, which administers every tenant, had none of it.
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

  // Tokens minted before this shipped carry no `sid`. Accept them once, without
  // a session, so deploying does not sign out every platform admin mid-shift —
  // the same degradation the tenant tier accepted for SEC-C2. They rotate onto
  // a real session on their next refresh and the grace ends by itself.
  if (!payload.sid) {
    const opened = await openSession(user);
    return {
      access_token: signAccess(user),
      refresh_token: opened.refreshToken,
      token_type: "Bearer",
      expires_in: config.JWT_ACCESS_TTL,
      user: { ...userPayload(user), capabilities: await loadCaps(user.role) },
    };
  }

  const s = (await platformDb.query(
    `SELECT session_id, killed_at, replaced_by, expires_at, refresh_jti
       FROM platform.platform_session WHERE session_id = $1`,
    [payload.sid],
  )).rows[0];

  if (!s) throw new AppError("SESSION_REVOKED", "This session no longer exists", 401);
  if (s.killed_at) throw new AppError("SESSION_REVOKED", "This session has been ended", 401);
  if (new Date(s.expires_at) <= new Date()) {
    throw new AppError("SESSION_REVOKED", "This session has expired", 401);
  }
  // REUSE: the chain moved on without this token, so this token is a copy.
  if (s.replaced_by || s.refresh_jti !== payload.jti) {
    await killChain(s.session_id);
    logger.warn(
      { platform_user_id: user.platform_user_id, sid: s.session_id },
      "platform refresh REUSE detected — session chain killed",
    );
    throw new AppError("SESSION_REVOKED", "This session has been ended", 401);
  }

  const next = await openSession(user);
  await platformDb.query(
    `UPDATE platform.platform_session
        SET replaced_by = $2, last_seen_at = now()
      WHERE session_id = $1`,
    [s.session_id, next.sessionId],
  );

  return {
    access_token: signAccess(user),
    refresh_token: next.refreshToken,
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: { ...userPayload(user), capabilities: await loadCaps(user.role) },
  };
}

/** Remote kill — the lever that did not exist at this tier. */
async function killSession({ sessionId, actorId = null }) {
  await killChain(sessionId, actorId);
  return { killed: true, session_id: sessionId };
}

/** Every live session for a platform user. */
async function listSessions(platformUserId) {
  const { rows } = await platformDb.query(
    `SELECT session_id, issued_at, last_seen_at, expires_at, ip, user_agent
       FROM platform.platform_session
      WHERE platform_user_id = $1 AND killed_at IS NULL AND expires_at > now()
      ORDER BY issued_at DESC`,
    [platformUserId],
  );
  return rows;
}

module.exports = { login, refresh, killSession, listSessions, PLATFORM_REFRESH_TTL };
