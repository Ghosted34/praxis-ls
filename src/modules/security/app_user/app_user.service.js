/**
 * Generic CRUD (list/get/create/update/archive on app_user) plus login/
 * refresh/logout/2FA — formerly security/auth/auth.service.js, folded in
 * here since it's the same table's business logic. See doc/WORK_DONE.md.
 *
 *   - login: real (Argon2id verify, session row, access+refresh JWT). When
 *     is_2fa_enabled, returns a short-lived pending-2FA token instead of
 *     the real pair.
 *   - verifyTotp: exchanges that pending token + a TOTP code for the real
 *     access+refresh pair. Decision taken here (previously an open TODO,
 *     "needs a decision, not invented here"): the pending token is a JWT
 *     signed with the same JWT_ACCESS_SECRET, typ:"2fa_pending", 5-minute
 *     TTL, sub:userId. It carries no session — a session is only created
 *     once the code checks out. This only works as a real security
 *     boundary because middleware/auth.js now rejects any typ other than
 *     "access" (it didn't check typ at all before — see doc/WORK_DONE.md;
 *     that gap meant a refresh token, which already carried typ:"refresh",
 *     could have been replayed as an access token).
 *   - setupTotp/enableTotp/disableTotp: the enrollment lifecycle needed to
 *     ever populate totp_secret_enc in the first place — didn't exist
 *     anywhere before this, so verifyTotp would've been unreachable
 *     without it. setup generates+stores a secret but does NOT flip
 *     is_2fa_enabled; enable requires proving one valid code first.
 *   - refresh: real (verifies the refresh JWT + that its session is alive).
 *   - logout: real (kills the session, invalidates the identity cache).
 */
"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { authenticator } = require("otplib");

const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { mirrorUserBestEffort } = require("../../../shared/db/sandbox-user-mirror");
const identityCache = require("../../../shared/cache/identity-cache");
const sessionStore = require("../../../shared/cache/session-store");
const encryption = require("../../../services/encryption.service");
const emailService = require("../../../services/email.service");
const storage = require("../../../services/storage.service");
const passwordPolicy = require("../../../shared/security/password-policy");
const notificationRepo = require("../../notification/notification.repo");
const repo = require("./app_user.repo");
const events = require("./app_user.events");
const governance = require("../../ai/governance/governance.service");

const TWOFA_PENDING_TTL = "5m";
/** Reset links live for 30 minutes and are single-use (doc plan §1.1). */
const RESET_TTL_MIN = 30;
/** Feature flag that turns the whole AI surface on/off for a tenant. Drives the
 *  FE global AI gate — see client/src/components/ai-actions.tsx. */
const AI_FEATURE_KEY = "ai.assistant.backend";

/** Resolve the tenant-level AI switch for the login payload. Never throws — if
 *  the flag/table is missing or the read errors, AI is treated as OFF (opt-in),
 *  so a governance hiccup can never block sign-in. */
async function resolveAiEnabled(client) {
  try {
    return await governance.isFeatureEnabled(client, AI_FEATURE_KEY);
  } catch {
    return false;
  }
}

/** Resolve which comms channels are switched on for the tenant. WhatsApp /
 *  Instagram stay hidden in the UI until enabled (like AI). Never throws. */
async function resolveChannels(client) {
  const read = async (k) => { try { return await governance.isFeatureEnabled(client, k); } catch { return false; } };
  return { comms: await read("comms"), whatsapp: await read("whatsapp"), instagram: await read("instagram") };
}

/**
 * Access tokens now carry `sid` — the session they belong to.
 *
 * Audit SEC-C2 (Critical). Logout is authenticated by the ACCESS token, but the
 * access token carried only `{ sub, jti }`. The server therefore had no way to
 * know which session the caller was in, and `logout()` fell back to
 * `req.body.session_id` — which the client never sends. So logout invalidated
 * the identity cache, emitted a LOGGED_OUT event, returned
 * `{ logged_out: true }`, and left the session row alive and the refresh token
 * valid. Anyone holding that refresh token could mint new access tokens
 * indefinitely, including after the user had "signed out" on a shared machine.
 *
 * Binding the session id into the access token is also the groundwork for
 * SEC-M1 (access tokens are not session-bound, so revocation does not revoke) —
 * `authMiddleware` can now check the session on each request once that is taken
 * on deliberately.
 *
 * Backward compatible: tokens issued before this change have no `sid`. They
 * keep working until they expire (15 minutes), and logout for those callers
 * degrades to the previous body-parameter behaviour rather than erroring.
 */
function signAccessToken({ userId, jti, sessionId }) {
  return jwt.sign(
    { sub: userId, jti, sid: sessionId, typ: "access" },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL },
  );
}

function signRefreshToken({ userId, sessionId, jti }) {
  return jwt.sign(
    { sub: userId, sid: sessionId, jti, typ: "refresh" },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_TTL },
  );
}

function signPendingTwoFaToken(userId) {
  return jwt.sign({ sub: userId, typ: "2fa_pending" }, config.JWT_ACCESS_SECRET, {
    expiresIn: TWOFA_PENDING_TTL,
  });
}

/** Shared by login() (no-2FA path) and verifyTotp() (post-2FA path) — the
 *  actual "you're in" step: session row + Redis index + real token pair. */
async function issueSessionTokens(client, user, { ip, userAgent, environment, keepSignedIn }) {
  await repo.recordLoginSuccess(client, user.user_id);
  const sessionId = await repo.createSession(client, {
    userId: user.user_id,
    ip,
    userAgent,
    environment,
    // "Keep me signed in" exempts the session from the idle kill (0494).
    keepSignedIn,
  });
  await sessionStore.indexSession(sessionId, { userId: user.user_id, ip, userAgent, environment });

  const jti = uuid();
  // SEC-C2: bind the access token to its session so logout can revoke it.
  const accessToken = signAccessToken({ userId: user.user_id, jti, sessionId });
  const refreshJti = uuid();
  const refreshToken = signRefreshToken({ userId: user.user_id, sessionId, jti: refreshJti });
  await repo.setRefreshJti(client, sessionId, refreshJti); // for rotation reuse-detection

  await identityCache.invalidateUser(user.user_id); // drop any stale cached (e.g. inactive) entry
  await emitEvent(client, {
    eventTypeKey: events.LOGIN_SUCCEEDED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${user.user_id}`,
    actorUserId: user.user_id,
  });
  // Snapshot actor identity (0510) so the Control Tower's self-scoped audit
  // feed can render a card without a cross-schema join back to app_user. The
  // user record is already in hand from findByEmail above.
  await audit(client, {
    actorUserId: user.user_id,
    actorName: user.full_name || user.email || null,
    actorEmail: user.email || null,
    action: events.LOGIN_SUCCEEDED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${user.user_id}`,
    ip,
  });

  const aiEnabled = await resolveAiEnabled(client);
  const channels = await resolveChannels(client);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: config.JWT_ACCESS_TTL,
    user: { user_id: user.user_id, email: user.email, display_name: user.full_name, ai_enabled: aiEnabled, channels },
  };
}

/**
 * Per-account login cooldown (audit SEC-C3, second half).
 *
 * `failed_logins` has been counted since migration 0100 and never read. The IP
 * limiter added on 2026-08-04 stops one address hammering the endpoint; this
 * stops a distributed attempt on ONE account, which an IP limiter cannot see.
 *
 * Deliberately a decaying cooldown, NOT a lockout:
 *
 *   - A lockout is a denial-of-service lever. Anyone who knows a colleague's
 *     email could disable their account by failing ten logins, and if clearing
 *     it needs an administrator, one attacker takes out the finance team before
 *     lunch. That swaps a brute-force problem for a worse availability one.
 *   - This never latches. The delay is a function of the failure count and the
 *     time since the last failure, so it expires on its own and a successful
 *     login clears it. Nothing needs an admin.
 *   - The first 5 failures cost nothing, so an ordinary mistyped password is
 *     unaffected. Beyond that the wait doubles: 6th → 2s, 8th → 8s, 10th → 32s,
 *     capped at 15 minutes. Against automated guessing that is decisive;
 *     against a human who forgot their password it is barely noticeable.
 *
 * `status = 'LOCKED'` remains the deliberate administrative lockout and is
 * untouched by any of this.
 *
 * @returns {number} seconds the caller must wait; 0 when not throttled.
 */
const THROTTLE_FREE_ATTEMPTS = 5;
const THROTTLE_MAX_SECONDS = 15 * 60;

function throttleFor(user, now = Date.now()) {
  const failures = Number(user && user.failed_logins) || 0;
  if (failures <= THROTTLE_FREE_ATTEMPTS) return 0;
  if (!user.last_failed_login_at) return 0;

  const required = Math.min(
    2 ** (failures - THROTTLE_FREE_ATTEMPTS),
    THROTTLE_MAX_SECONDS,
  );
  const elapsed = (now - new Date(user.last_failed_login_at).getTime()) / 1000;
  const remaining = Math.ceil(required - elapsed);
  return remaining > 0 ? remaining : 0;
}

async function login(client, { email, password, ip, userAgent, environment, keepSignedIn }) {
  const user = await repo.findByEmail(client, String(email || "").toLowerCase());

  // SEC-C3. Checked BEFORE argon2.verify: verification is deliberately
  // expensive (that is the point of argon2), so an unthrottled attacker gets a
  // free CPU-exhaustion vector on top of the guessing.
  //
  // This answers with a distinct code rather than the generic
  // INVALID_CREDENTIALS. It does confirm the account exists — but the IP
  // limiter already caps an enumerator at 10 attempts per 15 minutes, and this
  // path is only reachable after 6 failures against one specific address, so it
  // is a poor enumeration oracle. The trade buys a real answer for the
  // legitimate user who has since remembered their password and would otherwise
  // be told, wrongly, that it is invalid.
  if (user) {
    const wait = throttleFor(user);
    if (wait > 0) {
      await emitEvent(client, {
        eventTypeKey: events.LOGIN_FAILED,
        moduleKey: events.MODULE,
        entityRef: `app_user:${user.user_id}`,
        payload: { email, reason: "throttled", failed_logins: user.failed_logins },
      });
      throw new AppError(
        "LOGIN_THROTTLED",
        `Too many failed attempts. Try again in ${wait} second${wait === 1 ? "" : "s"}.`,
        429,
        { retry_after_seconds: wait },
      );
    }
  }

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
    return {
      pending_2fa: true,
      pending_token: signPendingTwoFaToken(user.user_id),
      expires_in: TWOFA_PENDING_TTL,
    };
  }

  return issueSessionTokens(client, user, { ip, userAgent, environment, keepSignedIn });
}

async function verifyTotp(client, { pendingToken, code, ip, userAgent, environment, keepSignedIn }) {
  let payload;
  try {
    payload = jwt.verify(pendingToken, config.JWT_ACCESS_SECRET);
  } catch {
    throw new AppError("INVALID_TOKEN", "Invalid or expired 2FA challenge", 401);
  }
  if (payload.typ !== "2fa_pending") {
    throw new AppError("INVALID_TOKEN", "Not a 2FA challenge token", 401);
  }

  const user = await repo.getTotpSecret(client, payload.sub);
  if (!user || !user.is_2fa_enabled || !user.totp_secret_enc) {
    throw new AppError("INVALID_TOKEN", "2FA is not enabled for this account", 401);
  }

  const secret = encryption.decrypt(user.totp_secret_enc);
  const ok = authenticator.verify({ token: String(code || ""), secret });
  if (!ok) {
    await repo.recordLoginFailure(client, user.user_id);
    throw new AppError("INVALID_2FA_CODE", "Invalid authentication code", 401);
  }

  return issueSessionTokens(client, user, { ip, userAgent, environment, keepSignedIn });
}

/** Generates+stores a secret but does NOT enable 2FA yet — enableTotp()
 *  requires proving one valid code against it first, so a user can't
 *  lock themselves out by fat-fingering enrollment. */
async function setupTotp(client, userId) {
  const user = await repo.getTotpSecret(client, userId);
  if (!user) throw new AppError("NOT_FOUND", "User not found", 404);

  const secret = authenticator.generateSecret();
  await repo.setTotpSecret(client, userId, encryption.encrypt(secret));
  const otpauthUrl = authenticator.keyuri(user.email, "Praxis LS", secret);
  return { secret, otpauth_url: otpauthUrl };
}

async function enableTotp(client, userId, code) {
  const user = await repo.getTotpSecret(client, userId);
  if (!user || !user.totp_secret_enc) {
    throw new AppError("SETUP_REQUIRED", "Run 2FA setup before enabling", 400);
  }
  const secret = encryption.decrypt(user.totp_secret_enc);
  if (!authenticator.verify({ token: String(code || ""), secret })) {
    throw new AppError("INVALID_2FA_CODE", "Invalid authentication code", 401);
  }
  await repo.setTotpEnabled(client, userId, true);
  await identityCache.invalidateUser(userId);
  await emitEvent(client, {
    eventTypeKey: events.TWOFA_ENABLED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${userId}`,
    actorUserId: userId,
  });
  await audit(client, {
    actorUserId: userId,
    actorName: user.full_name || user.email || null,
    actorEmail: user.email || null,
    action: events.TWOFA_ENABLED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${userId}`,
    // Enabling 2FA is a security-posture change — deserves the badge.
    isSensitive: true,
  });
  return { is_2fa_enabled: true };
}

async function disableTotp(client, userId, code) {
  const user = await repo.getTotpSecret(client, userId);
  if (!user || !user.is_2fa_enabled) {
    throw new AppError("NOT_ENABLED", "2FA is not enabled", 400);
  }
  const secret = encryption.decrypt(user.totp_secret_enc);
  if (!authenticator.verify({ token: String(code || ""), secret })) {
    throw new AppError("INVALID_2FA_CODE", "Invalid authentication code", 401);
  }
  await repo.setTotpEnabled(client, userId, false);
  await identityCache.invalidateUser(userId);
  await emitEvent(client, {
    eventTypeKey: events.TWOFA_DISABLED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${userId}`,
    actorUserId: userId,
  });
  await audit(client, {
    actorUserId: userId,
    actorName: user.full_name || user.email || null,
    actorEmail: user.email || null,
    action: events.TWOFA_DISABLED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${userId}`,
    // Disabling 2FA weakens the account — sensitive.
    isSensitive: true,
  });
  return { is_2fa_enabled: false };
}

/** Pure reuse-detection predicate (exported for tests): true when the presented
 *  refresh token's jti is NOT the session's current one — i.e. a rotated-away /
 *  replayed token. Legacy sessions (no `refresh_jti` yet) return false, so they're
 *  grandfathered until their next refresh stamps a jti. */
function refreshTokenReused(session, payload) {
  return !!(session && session.refresh_jti && payload && payload.jti && session.refresh_jti !== payload.jti);
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

  // Rotation reuse-detection: the presented refresh token must be the session's
  // CURRENT one. A mismatch means a rotated-away (old / replayed) token was used
  // after rotation — treat it as a compromise signal and revoke the whole
  // session. Legacy sessions with a NULL refresh_jti (issued before rotation
  // shipped) are grandfathered until their next refresh stamps one.
  if (refreshTokenReused(session, payload)) {
    await repo.killSession(client, payload.sid, payload.sub);
    await sessionStore.removeSession(payload.sid, payload.sub);
    await identityCache.invalidateUser(payload.sub);
    await emitEvent(client, {
      eventTypeKey: events.LOGGED_OUT,
      moduleKey: events.MODULE,
      entityRef: `app_user:${payload.sub}`,
      actorUserId: payload.sub,
      payload: { reason: "refresh_token_reuse" },
    });
    throw new AppError("SESSION_REVOKED", "Refresh token reuse detected; session revoked", 401);
  }

  // 30-min inactivity auto-logout (SESSION_INACTIVITY_MIN, PRD §5.7). This is
  // the enforcement point that was missing: the value was configured but never
  // checked anywhere. Inactivity is measured from last_seen_at, which is
  // bumped on every refresh below — so a client that stops refreshing (idle)
  // past the window gets its session killed and must re-authenticate.
  // Tradeoff (same one already documented for remote session-kill): an access
  // token already issued stays valid until its own short (15 min) expiry; this
  // blocks the *refresh* that would extend the session, it doesn't retroactively
  // revoke a live access token.
  // "Keep me signed in" opts out of the idle kill (0494). The checkbox promised
  // a 30-day refresh token and this timeout quietly cut it to 30 minutes, which
  // is what users reported as "token expired" after stepping away. Rotation,
  // reuse detection, remote kill and the refresh TTL all still apply — this is a
  // longer leash, not an exemption from revocation.
  const idleSeconds = Number(session.idle_seconds);
  if (
    session.keep_signed_in !== true
    && Number.isFinite(idleSeconds)
    && idleSeconds > config.SESSION_INACTIVITY_MIN * 60
  ) {
    await repo.killSession(client, payload.sid, payload.sub);
    await sessionStore.removeSession(payload.sid, payload.sub);
    await identityCache.invalidateUser(payload.sub);
    await emitEvent(client, {
      eventTypeKey: events.LOGGED_OUT,
      moduleKey: events.MODULE,
      entityRef: `app_user:${payload.sub}`,
      actorUserId: payload.sub,
      payload: { reason: "inactivity_timeout", idle_seconds: Math.round(idleSeconds) },
    });
    throw new AppError("SESSION_EXPIRED", "Session expired due to inactivity", 401);
  }

  await repo.touchSession(client, payload.sid);
  // SEC-C2: carry the session through rotation too. Without this, a client that
  // has refreshed once holds an access token with no `sid` and logout silently
  // reverts to revoking nothing — which is the original bug, reintroduced after
  // fifteen minutes of use.
  const accessToken = signAccessToken({ userId: payload.sub, jti: uuid(), sessionId: payload.sid });
  // Refresh-token rotation: mint a fresh refresh token (new jti + sliding exp)
  // bound to the SAME session and return it. The client swaps its stored token
  // for this one (already wired FE-side), so each refresh shortens the window in
  // which any single refresh token is usable. Session identity/validity is still
  // the source of truth (getActiveSession above) — this doesn't create a new
  // session, it re-issues the credential for the existing one.
  const newRefreshJti = uuid();
  const rotatedRefreshToken = signRefreshToken({ userId: payload.sub, sessionId: payload.sid, jti: newRefreshJti });
  await repo.setRefreshJti(client, payload.sid, newRefreshJti);

  // No emitEvent + no audit here on purpose. Silent token refresh happens
  // every ~15 min on every active tab; it is machine noise, not user activity.
  // Recording it drowned the Control Tower's self-scoped "Recent activity"
  // feed in "Auth token refreshed · App user c2d39ee8" rows — the very defect
  // the /audit/my-feed rebuild exists to fix. The `TOKEN_REFRESHED` constant
  // in app_user.events.js is retained (other paths may reference it), we just
  // don't emit it here.
  //
  // The important auth events — login_succeeded, logged_out, login_failed —
  // stay: those are user-initiated and belong in the feed.

  return { access_token: accessToken, refresh_token: rotatedRefreshToken, token_type: "Bearer", expires_in: config.JWT_ACCESS_TTL };
}

/** Recompute the login user block (ai_enabled/channels) for the already-signed-in
 *  user, without a full re-login. Lets a platform-console feature toggle reflect
 *  on the next poll/refresh instead of forcing sign-out. Same source of truth as
 *  issueSessionTokens (resolveAiEnabled/resolveChannels → effective feature_state). */
async function me(client, user) {
  const ai_enabled = await resolveAiEnabled(client);
  const channels = await resolveChannels(client);
  const roles = await repo.roleNames(client, user.user_id).catch(() => []);
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    employee_id: user.employee_id || null,
    avatar_url: user.avatar_ref || null,
    // Primary role for the account menu; "+N" hints at additional roles.
    role: roles.length ? (roles.length > 1 ? `${roles[0]} +${roles.length - 1}` : roles[0]) : null,
    ai_enabled,
    channels,
  };
}

// ── Self-service profile picture ──
const AVATAR_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_AVATAR_BYTES = 1024 * 1024; // 1 MB

/** Store a base64 data-URL avatar and set it on the user. Returns the /media URL. */
async function setAvatar(client, { userId, dataUrl, slug }) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new AppError("BAD_IMAGE", "Expected a base64 image data URL", 400);
  const contentType = m[1].toLowerCase();
  const ext = AVATAR_EXT[contentType];
  if (!ext) throw new AppError("UNSUPPORTED_IMAGE", `Unsupported image type: ${contentType}`, 415);
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_AVATAR_BYTES) throw new AppError("IMAGE_TOO_LARGE", "Avatar must be 1 MB or smaller", 413);

  const key = `tenant_${slug || "t"}/avatars/${userId}_${crypto.randomBytes(5).toString("hex")}.${ext}`;
  const stored = await storage.put(buffer, { key, contentType });
  const row = await repo.setAvatar(client, userId, stored.public_url);
  await identityCache.invalidateUser(userId); // so the new avatar shows on next request
  await audit(client, { actorUserId: userId, action: "app_user.avatar_set", moduleKey: events.MODULE, entityRef: "app_user:" + userId });
  return { avatar_url: (row && row.avatar_ref) || stored.public_url };
}

/**
 * End the caller's session (audit SEC-C2, Critical).
 *
 * What this used to do: take `sessionId` from `req.body.session_id`, which the
 * client never sends, skip the whole revocation block, and return
 * `{ logged_out: true }`. The session row stayed alive and the refresh token
 * stayed valid — so "sign out" on a shared machine ended nothing, and anyone
 * holding the refresh token kept minting access tokens.
 *
 * The session now comes from the ACCESS TOKEN (`sid`), so the caller cannot
 * fail to supply it and cannot choose someone else's. An explicitly passed
 * session_id is still honoured for "sign out this other device", but it is
 * checked against the caller — see the ownership guard below (SEC-M2 notes the
 * same gap in killSession).
 */
async function logout(client, { actor, sessionId }) {
  // Prefer the session bound to the presented token. Fall back to an explicit
  // id only when the token predates SEC-C2 (issued before this shipped, ≤15
  // minutes) or the caller is deliberately killing another device.
  const target = sessionId || (actor && actor.session_id) || null;

  if (target) {
    // SEC-M2: killSession had no ownership predicate, so a caller could revoke
    // any session id they could guess. Scope the kill to the acting user.
    await repo.killSession(client, target, actor.user_id);
    await sessionStore.removeSession(target, actor.user_id);
  } else {
    // No session identifiable. Previously this path silently returned success;
    // it is the exact shape of the bug, so it is now loud rather than quiet.
    logger.warn(
      { user_id: actor && actor.user_id },
      "logout could not identify a session to revoke — token predates SEC-C2 and no session_id was supplied",
    );
  }
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
  // Report what actually happened rather than an unconditional success.
  return { logged_out: true, session_revoked: Boolean(target) };
}


// ── Self-service password reset (email one-time link) ──
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/** Branded HTML for the reset email. Kept inline (no template engine) and
 *  table-free/simple so it renders in strict mail clients. */
function resetEmailHtml({ name, link }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Roboto,'Noto Sans',sans-serif;color:#101e34">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="background:#ffffff;border-radius:14px;padding:32px;box-shadow:0 4px 12px rgba(16,30,52,.06)">
      <h1 style="margin:0 0 12px;font-size:20px;color:#101e34">Reset your password</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#4e6280">Hi ${name}, we received a request to reset your Praxis LS password. Click the button below to choose a new one. This link expires in ${RESET_TTL_MIN} minutes and can be used once.</p>
      <p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#F5821F;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:15px">Reset password</a></p>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#84a0b0">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#1c9bd7">${link}</span></p>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#84a0b0">Didn't request this? You can safely ignore this email — your password won't change.</p>
    </div>
  </div></body></html>`;
}

async function sendResetEmail(client, { to, name, token, origin }) {
  const base = origin || `https://app.${config.APP_BASE_DOMAIN}`;
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  const firstName = name ? String(name).trim().split(/\s+/)[0] : "there";
  const text = `Hi ${firstName},\n\nWe received a request to reset your Praxis LS password. Open the link below within ${RESET_TTL_MIN} minutes to choose a new one (single use):\n\n${link}\n\nIf you didn't request this, ignore this email — your password won't change.`;
  await emailService.send(client, {
    to,
    subject: "Reset your Praxis LS password",
    html: resetEmailHtml({ name: firstName, link }),
    text,
    purpose: "NOTIFICATIONS",
    moduleKey: events.MODULE,
  });
}

/**
 * Begin recovery. ALWAYS resolves to { ok: true } regardless of whether the
 * email maps to an active account — we must not leak which addresses exist
 * (mirrors login()'s "same error for no-such-user vs wrong-password" stance).
 * A live token is created and mailed only for an ACTIVE user.
 */
async function requestPasswordReset(client, { email, ip, origin }) {
  const normalized = String(email || "").toLowerCase();
  const user = await repo.findByEmail(client, normalized);

  if (user && user.status === "ACTIVE") {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);
    await repo.invalidateUserResets(client, user.user_id); // one live link at a time
    await repo.createResetToken(client, { userId: user.user_id, tokenHash: sha256(token), expiresAt, ip });
    await emitEvent(client, { eventTypeKey: events.PASSWORD_RESET_REQUESTED, moduleKey: events.MODULE, entityRef: `app_user:${user.user_id}`, actorUserId: user.user_id });
    await audit(client, { actorUserId: user.user_id, action: events.PASSWORD_RESET_REQUESTED, moduleKey: events.MODULE, entityRef: `app_user:${user.user_id}`, ip });
    try {
      await sendResetEmail(client, { to: user.email, name: user.full_name, token, origin });
    } catch (err) {
      // Mail failure must not change the response (no enumeration) — the token
      // stays valid so a retry/resend can still deliver. Surface it in logs.
      logger.error({ err, user_id: user.user_id }, "[auth] password-reset email failed to send");
    }
  }
  return { ok: true };
}

/**
 * Complete recovery: verify the one-time token, apply the full password policy
 * (length/complexity + HIBP breach check), re-hash with Argon2id, mark the token
 * used, and FORCE-LOGOUT every session the user has (decided behaviour).
 */
async function resetPassword(client, { token, newPassword, ip }) {
  const invalid = () => new AppError("INVALID_RESET_TOKEN", "This reset link is invalid or has expired. Please request a new one.", 400);
  if (!token) throw invalid();

  const row = await repo.findResetByHash(client, sha256(token));
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) throw invalid();

  const user = await repo.getUserSafe(client, row.user_id);
  if (!user || user.status !== "ACTIVE") throw invalid();

  // Enforce policy BEFORE opening a transaction (HIBP call can be slow).
  await passwordPolicy.assertStrongPassword(newPassword, { email: user.email });

  await client.query("BEGIN");
  let killed = [];
  try {
    const hash = await argon2.hash(String(newPassword), ARGON);
    await repo.setPasswordHash(client, user.user_id, hash);
    await repo.markResetUsed(client, row.reset_id);
    killed = await repo.killAllSessionsForUser(client, user.user_id, user.user_id);
    // Security notification to the affected user (unconditional — security alerts
    // ignore preferences). They'll see it in their inbox on next sign-in; it's the
    // "your password changed, and if it wasn't you, act now" trail.
    await notificationRepo.insertForUser(client, {
      userId: user.user_id,
      eventTypeKey: events.PASSWORD_RESET_COMPLETED,
      title: "Your password was changed",
      body: "Your password was reset and all sessions were signed out. If this wasn't you, contact your administrator immediately.",
      entityRef: `app_user:${user.user_id}`,
      priority: "HIGH",
      category: "security",
    });
    await emitEvent(client, { eventTypeKey: events.PASSWORD_RESET_COMPLETED, moduleKey: events.MODULE, entityRef: `app_user:${user.user_id}`, actorUserId: user.user_id });
    await audit(client, { actorUserId: user.user_id, action: events.PASSWORD_RESET_COMPLETED, moduleKey: events.MODULE, entityRef: `app_user:${user.user_id}`, ip });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  // Best-effort cache/session-index cleanup (outside the txn — a Redis hiccup
  // must not undo a committed password change).
  await identityCache.invalidateUser(user.user_id);
  await Promise.allSettled(killed.map((sid) => sessionStore.removeSession(sid, user.user_id)));
  return { reset: true };
}


// ── User administration (Argon2id password, roles, lifecycle) ──
const ARGON = { type: argon2.argon2id };

async function listUsers(client, q = {}) {
  const rows = await repo.listUsersSafe(client, { limit: q.limit, offset: q.offset, status: q.status, q: q.q });
  return rows;
}
async function getUser(client, id) {
  const u = await repo.getUserSafe(client, id);
  if (!u) throw new AppError("NOT_FOUND", "User not found", 404);
  u.role_ids = await repo.roleIds(client, id);
  return u;
}
/** Employees linkable to a user — always the live/identity schema (see repo). */
const listLinkableEmployees = (client) => repo.listEmployeesLite(client);
async function createUser(client, { data, actor = {} }) {
  await passwordPolicy.assertStrongPassword(data.password, { email: data.email });
  await client.query("BEGIN");
  try {
    const password_hash = await argon2.hash(String(data.password), ARGON);
    const user = await repo.insertUser(client, {
      username: data.username || null, email: String(data.email).toLowerCase(), full_name: data.full_name,
      password_hash, status: data.status || "ACTIVE", employee_id: data.employee_id || null,
    });
    if (Array.isArray(data.role_ids)) await repo.setRoles(client, user.user_id, data.role_ids);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "app_user:" + user.user_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "app_user:" + user.user_id, after: user });
    await client.query("COMMIT");
    // Mirror into the sandbox schema so this user's TEST-mode writes can satisfy
    // the 60+ `REFERENCES app_user(user_id)` actor columns over there (identity is
    // pinned to LIVE, business data is not — see shared/db/sandbox-user-mirror.js).
    // AFTER the commit and best-effort on purpose: a sandbox problem must never
    // roll back or fail a live user create.
    await mirrorUserBestEffort(client, user.user_id);
    return getUser(client, user.user_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
/**
 * SEC H4 (High). MOD-67 `edit` could take over any account, including the CEO,
 * with no re-authentication.
 *
 * Two routes, both gated only on MOD-67 `edit` — an entirely ordinary
 * delegation to an office manager who needs to onboard staff and reset
 * forgotten passwords:
 *
 *   PATCH /users/:id          replaces role_ids wholesale. The only guard was
 *                             the LAST-CEO check, which stops REMOVING the CEO
 *                             role from the final CEO. Nothing stopped ADDING
 *                             one, and nothing stopped acting on yourself. One
 *                             `PATCH /users/{my own id}` adding the CEO role,
 *                             and because the same call invalidates the identity
 *                             cache, `is_ceo` is true on the very next request —
 *                             at which point every requirePermission,
 *                             requireCapability and requireCeo in the product
 *                             returns early without consulting a grant.
 *
 *   POST /users/:id/password  sets any user's password without knowing it, the
 *                             actor's own, or facing a step-up challenge. The
 *                             quieter takeover: set the CEO's password, sign in
 *                             as them, and the ledger attributes everything that
 *                             follows to the CEO.
 *
 * THREE RULES, and the reasoning for each boundary:
 *
 *   1. YOU MAY NOT GRANT A ROLE YOU DO NOT HOLD. This is the general form of
 *      "no self-elevation to CEO" and it is the one that matters — blocking
 *      only the CEO role would leave every other privileged role open, and
 *      would be trivially circumvented via a role that itself grants MOD-67.
 *      A CEO holds everything, so a CEO can still delegate anything.
 *
 *   2. YOU MAY NOT CHANGE YOUR OWN ROLES AT ALL. Rule 1 already blocks
 *      elevation, but self-editing roles is not a thing an administrator needs
 *      to do, and forbidding it outright removes a whole class of ordering and
 *      race arguments rather than reasoning about each.
 *
 *   3. ONLY A CEO MAY SET A CEO'S PASSWORD. Anything less means the account
 *      that bypasses every check in the system can be captured by a delegated
 *      grant.
 *
 * What this deliberately does NOT do is add a step-up re-authentication
 * challenge, which the audit also suggests. That needs a UI flow and a decision
 * about what re-auth means for an SSO session; these three rules close the
 * escalation path on their own and do not depend on one.
 */
async function assertMayChangeRoles(client, { id, roleIds, actor }) {
  if (!actor || !actor.user_id) {
    throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
  }
  if (String(actor.user_id) === String(id)) {
    // A NO-OP self-edit is allowed. The user-edit form posts the whole record,
    // role_ids included, so refusing outright would 403 an administrator who
    // only changed their own phone number. Compared as SETS: same roles, same
    // count, in any order. Anything that actually differs is still refused,
    // which is the property that matters.
    const currentIds = (await repo.roleIds(client, id)).map(String).sort();
    const nextIds = [...new Set(roleIds.map(String))].sort();
    const unchanged =
      currentIds.length === nextIds.length && currentIds.every((r, i) => r === nextIds[i]);
    if (!unchanged) {
      throw new AppError(
        "SELF_ROLE_CHANGE",
        "You cannot change your own roles. Ask another administrator.",
        403,
      );
    }
    return;
  }
  if (actor.is_ceo) return; // holds everything already

  const actorRoleIds = (await repo.roleIds(client, actor.user_id)).map(String);
  const held = new Set(actorRoleIds);
  const granting = roleIds.map(String).filter((r) => !held.has(r));
  if (granting.length === 0) return;

  const names = await repo.roleNamesByIds(client, granting);
  throw new AppError(
    "ROLE_ESCALATION",
    `You cannot grant ${names.length ? names.join(", ") : "a role"} because you do not hold ${names.length === 1 ? "it" : "them"}.`,
    403,
  );
}

/** SEC H4, rule 3. */
async function assertMaySetPassword(client, { id, actor }) {
  if (!actor || !actor.user_id) {
    throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
  }
  if (String(actor.user_id) === String(id)) return; // your own password is yours
  const targetCodes = await repo.roleCodes(client, id);
  if (targetCodes.includes("CEO") && !actor.is_ceo) {
    throw new AppError(
      "PRIVILEGED_TARGET",
      "Only a CEO can set a CEO's password. Use the password-reset flow so the account holder chooses it.",
      403,
    );
  }
}

async function updateUser(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getUserSafe(client, id);
  if (!before) throw new AppError("NOT_FOUND", "User not found", 404);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["username", "full_name", "whatsapp_number"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (patch.email !== undefined) fields.email = String(patch.email).toLowerCase();
    // employee_id: only apply when it actually CHANGES, so editing other fields
    // never re-touches a now-stale employee link (that would raise a raw FK 409
    // and make the user impossible to edit). When it does change to a real value,
    // validate the target exists and return a clear message instead of a 23503.
    if (patch.employee_id !== undefined && (patch.employee_id || null) !== (before.employee_id || null)) {
      if (patch.employee_id && !(await repo.employeeExists(client, patch.employee_id))) {
        throw new AppError("EMPLOYEE_NOT_FOUND", "That employee record no longer exists — pick another or clear the link.", 422);
      }
      fields.employee_id = patch.employee_id || null;
    }
    if (Object.keys(fields).length) await repo.updateUserFields(client, id, fields);
    if (Array.isArray(patch.role_ids)) {
      // SEC H4: before the last-owner guard, which only ever looked at REMOVAL.
      await assertMayChangeRoles(client, { id, roleIds: patch.role_ids, actor });
      // Last-owner guard (4.3): don't let a role change strip the CEO role from
      // the last active CEO — that would strand the tenant with no owner. Mirrors
      // the existing last-CEO guard on setStatus.
      const currentCodes = await repo.roleCodes(client, id);
      if (currentCodes.includes("CEO")) {
        const ceoId = await repo.ceoRoleId(client);
        const keepsCeo = ceoId && patch.role_ids.map(String).includes(String(ceoId));
        if (!keepsCeo && (await repo.countActiveCeos(client)) <= 1) {
          throw new AppError("LAST_CEO", "Cannot remove the CEO role from the last active CEO", 409);
        }
      }
      await repo.setRoles(client, id, patch.role_ids);
    }
    await identityCache.invalidateUser(id);
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "app_user:" + id, before, after: fields });
    await client.query("COMMIT");
    // Self-heal, not a sync: this is a no-op when the user is already mirrored
    // (the insert conflicts and does nothing, so a renamed user keeps the old
    // display name in sandbox — cosmetic, nothing reads it as authoritative). Its
    // job is to catch users created BEFORE mirroring existed, whose first TEST
    // write would otherwise 23503; editing them now quietly fixes it.
    await mirrorUserBestEffort(client, id);
    return getUser(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
/** Admin/self password reset — Argon2id re-hash + drop cached identity. */
async function setPassword(client, { id, newPassword, actor = {} }) {
  const target = await repo.getUserSafe(client, id);
  if (!target) throw new AppError("NOT_FOUND", "User not found", 404);
  await assertMaySetPassword(client, { id, actor }); // SEC H4
  await passwordPolicy.assertStrongPassword(newPassword, { email: target.email });
  const hash = await argon2.hash(String(newPassword), ARGON);
  const row = await repo.setPasswordHash(client, id, hash);
  if (!row) throw new AppError("NOT_FOUND", "User not found", 404);
  await identityCache.invalidateUser(id);
  await audit(client, { actorUserId: actor.user_id || null, action: "app_user.password_set", moduleKey: events.MODULE, entityRef: "app_user:" + id });
  return { updated: true };
}
/** Lifecycle: ACTIVE / SUSPENDED / LOCKED. Cannot suspend/lock the last active CEO. */
async function setStatus(client, { id, status, actor = {} }) {
  if (!["ACTIVE", "SUSPENDED", "LOCKED"].includes(status)) throw new AppError("BAD_STATUS", "status must be ACTIVE/SUSPENDED/LOCKED", 422);
  const before = await repo.getUserSafe(client, id);
  if (!before) throw new AppError("NOT_FOUND", "User not found", 404);
  if (status !== "ACTIVE" && before.status === "ACTIVE") {
    const codes = await repo.roleCodes(client, id);
    if (codes.includes("CEO") && (await repo.countActiveCeos(client)) <= 1) {
      throw new AppError("LAST_CEO", "Cannot suspend/lock the last active CEO", 409);
    }
  }
  const row = await repo.setStatus(client, id, status);
  await identityCache.invalidateUser(id);
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "app_user:" + id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: "app_user.status." + status.toLowerCase(), moduleKey: events.MODULE, entityRef: "app_user:" + id, before, after: row });
  return row;
}

// ── Per-user email signature (2.1) ──
async function getSignature(client, userId) {
  const u = await repo.getUserSafe(client, userId);
  if (!u) throw new AppError("NOT_FOUND", "User not found", 404);
  return repo.getSignature(client, userId);
}
async function setSignature(client, { id, html, actor = {} }) {
  const u = await repo.getUserSafe(client, id);
  if (!u) throw new AppError("NOT_FOUND", "User not found", 404);
  const row = await repo.upsertSignature(client, id, html || "");
  await audit(client, { actorUserId: actor.user_id || null, action: "app_user.email_signature.set", moduleKey: events.MODULE, entityRef: "app_user:" + id, after: row });
  return row;
}

// ── Device-bound quick PIN login ──
// Fast unlock on a trusted device: a fully-authenticated user registers a PIN
// bound to a device; PIN login on that device issues real tokens. A new device
// or repeated PIN failures fall back to full password login (PIN + password
// fallback model). Registering requires a valid access token, so the device is
// already trusted — PIN login therefore skips the 2FA challenge.
const PIN_MAX_FAILS = 5;

async function registerPinDevice(client, { userId, pin, label = null }) {
  const user = await repo.getUserSafe(client, userId);
  if (!user) throw new AppError("NOT_FOUND", "User not found", 404);
  const pinHash = await argon2.hash(String(pin), ARGON);
  const row = await repo.insertDevice(client, { userId, label, pinHash });
  await audit(client, { actorUserId: userId, action: "app_user.pin_device.registered", moduleKey: events.MODULE, entityRef: "user_device:" + row.device_id });
  return { device_id: row.device_id, label: row.label, status: row.status, created_at: row.created_at };
}

async function pinLogin(client, { email, deviceId, pin, ip, userAgent, environment, keepSignedIn }) {
  const passwordFallback = new AppError("PIN_LOGIN_UNAVAILABLE", "Please sign in with your password", 401);
  const user = await repo.findByEmail(client, String(email || "").toLowerCase());
  if (!user || user.status !== "ACTIVE") throw passwordFallback;
  const device = await repo.getActiveDeviceForUser(client, deviceId, user.user_id);
  if (!device) throw passwordFallback; // unknown/revoked device → full login
  const ok = await argon2.verify(device.pin_hash, String(pin || "")).catch(() => false);
  if (!ok) {
    const { failed_pin } = await repo.recordDevicePinFailure(client, deviceId);
    const lockedOut = failed_pin >= PIN_MAX_FAILS;
    if (lockedOut) await repo.revokeDevice(client, deviceId, user.user_id);
    await emitEvent(client, { eventTypeKey: events.LOGIN_FAILED, moduleKey: events.MODULE, entityRef: "app_user:" + user.user_id, payload: { method: "pin", reason: lockedOut ? "pin_lockout" : "bad_pin" } });
    throw new AppError(lockedOut ? "PIN_LOCKED" : "INVALID_PIN", lockedOut ? "Too many attempts — sign in with your password" : "Invalid PIN", 401);
  }
  await repo.resetDevicePin(client, deviceId);
  return issueSessionTokens(client, user, { ip, userAgent, environment, keepSignedIn });
}

const listPinDevices = (client, userId) => repo.listDevices(client, userId);
async function revokePinDevice(client, { userId, deviceId }) {
  const row = await repo.revokeDevice(client, deviceId, userId);
  if (!row) throw new AppError("NOT_FOUND", "Device not found", 404);
  await audit(client, { actorUserId: userId, action: "app_user.pin_device.revoked", moduleKey: events.MODULE, entityRef: "user_device:" + deviceId });
  return { revoked: true };
}

module.exports = {
  listUsers, getUser, listLinkableEmployees, createUser, updateUser, setPassword, setStatus,
  getSignature, setSignature,
  registerPinDevice, pinLogin, listPinDevices, revokePinDevice,
  login,
  // Exported for tests: the throttle curve is the security-relevant decision
  // here, and it should be assertable without standing up a database.
  throttleFor,
  verifyTotp,
  setupTotp,
  enableTotp,
  disableTotp,
  refresh,
  refreshTokenReused,
  me,
  logout,
  setAvatar,
  requestPasswordReset,
  resetPassword,
};
