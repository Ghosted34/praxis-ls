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

const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { authenticator } = require("otplib");

const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const identityCache = require("../../../shared/cache/identity-cache");
const sessionStore = require("../../../shared/cache/session-store");
const encryption = require("../../../services/encryption.service");
const repo = require("./app_user.repo");
const events = require("./app_user.events");

const TWOFA_PENDING_TTL = "5m";

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

function signPendingTwoFaToken(userId) {
  return jwt.sign({ sub: userId, typ: "2fa_pending" }, config.JWT_ACCESS_SECRET, {
    expiresIn: TWOFA_PENDING_TTL,
  });
}

/** Shared by login() (no-2FA path) and verifyTotp() (post-2FA path) — the
 *  actual "you're in" step: session row + Redis index + real token pair. */
async function issueSessionTokens(client, user, { ip, userAgent, environment }) {
  await repo.recordLoginSuccess(client, user.user_id);
  const sessionId = await repo.createSession(client, {
    userId: user.user_id,
    ip,
    userAgent,
    environment,
  });
  await sessionStore.indexSession(sessionId, { userId: user.user_id, ip, userAgent, environment });

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
    return {
      pending_2fa: true,
      pending_token: signPendingTwoFaToken(user.user_id),
      expires_in: TWOFA_PENDING_TTL,
    };
  }

  return issueSessionTokens(client, user, { ip, userAgent, environment });
}

async function verifyTotp(client, { pendingToken, code, ip, userAgent, environment }) {
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

  return issueSessionTokens(client, user, { ip, userAgent, environment });
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
    action: events.TWOFA_ENABLED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${userId}`,
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
    action: events.TWOFA_DISABLED,
    moduleKey: events.MODULE,
    entityRef: `app_user:${userId}`,
  });
  return { is_2fa_enabled: false };
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

  // 30-min inactivity auto-logout (SESSION_INACTIVITY_MIN, PRD §5.7). This is
  // the enforcement point that was missing: the value was configured but never
  // checked anywhere. Inactivity is measured from last_seen_at, which is
  // bumped on every refresh below — so a client that stops refreshing (idle)
  // past the window gets its session killed and must re-authenticate.
  // Tradeoff (same one already documented for remote session-kill): an access
  // token already issued stays valid until its own short (15 min) expiry; this
  // blocks the *refresh* that would extend the session, it doesn't retroactively
  // revoke a live access token.
  const idleSeconds = Number(session.idle_seconds);
  if (Number.isFinite(idleSeconds) && idleSeconds > config.SESSION_INACTIVITY_MIN * 60) {
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
  if (sessionId) {
    await repo.killSession(client, sessionId, actor.user_id);
    await sessionStore.removeSession(sessionId, actor.user_id);
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
  return { logged_out: true };
}


// ── User administration (Argon2id password, roles, lifecycle) ──
const ARGON = { type: argon2.argon2id };

async function listUsers(client, q = {}) {
  const rows = await repo.listUsersSafe(client, { limit: q.limit, offset: q.offset, status: q.status });
  return rows;
}
async function getUser(client, id) {
  const u = await repo.getUserSafe(client, id);
  if (!u) throw new AppError("NOT_FOUND", "User not found", 404);
  u.role_ids = await repo.roleIds(client, id);
  return u;
}
async function createUser(client, { data, actor = {} }) {
  if (!data.password || String(data.password).length < 8) throw new AppError("WEAK_PASSWORD", "password must be at least 8 characters", 422);
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
    return getUser(client, user.user_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
async function updateUser(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getUserSafe(client, id);
  if (!before) throw new AppError("NOT_FOUND", "User not found", 404);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["username", "full_name", "employee_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (patch.email !== undefined) fields.email = String(patch.email).toLowerCase();
    if (Object.keys(fields).length) await repo.updateUserFields(client, id, fields);
    if (Array.isArray(patch.role_ids)) {
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
    return getUser(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}
/** Admin/self password reset — Argon2id re-hash + drop cached identity. */
async function setPassword(client, { id, newPassword, actor = {} }) {
  if (!newPassword || String(newPassword).length < 8) throw new AppError("WEAK_PASSWORD", "password must be at least 8 characters", 422);
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

async function pinLogin(client, { email, deviceId, pin, ip, userAgent, environment }) {
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
  return issueSessionTokens(client, user, { ip, userAgent, environment });
}

const listPinDevices = (client, userId) => repo.listDevices(client, userId);
async function revokePinDevice(client, { userId, deviceId }) {
  const row = await repo.revokeDevice(client, deviceId, userId);
  if (!row) throw new AppError("NOT_FOUND", "Device not found", 404);
  await audit(client, { actorUserId: userId, action: "app_user.pin_device.revoked", moduleKey: events.MODULE, entityRef: "user_device:" + deviceId });
  return { revoked: true };
}

module.exports = {
  listUsers, getUser, createUser, updateUser, setPassword, setStatus,
  getSignature, setSignature,
  registerPinDevice, pinLogin, listPinDevices, revokePinDevice,
  login,
  verifyTotp,
  setupTotp,
  enableTotp,
  disableTotp,
  refresh,
  logout,
};
