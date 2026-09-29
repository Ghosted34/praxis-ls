/**
 * Portal auth (PRD §11.1) — authentication for EXTERNAL portal users (client
 * contacts, investors, auditors). Deliberately parallel to app_user and kept off
 * the RBAC path: a portal user has no role/capability and can only ever reach the
 * scoped portal views. The token carries identity only; the *scope* is resolved
 * per request from portal_access (0340), so revoking a grant cuts access at once.
 */
"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const emailService = require("../../services/email.service");
const repo = require("./portal_auth.repo");
const { AppError } = require("../../utils/errors");
const passwordPolicy = require("../../shared/security/password-policy");

const TOKEN_TTL = "2h";
const TOKEN_TTL_S = 2 * 3600;
const MODULE = "MOD-67";

/**
 * "Keep me signed in" (14150). A client who ticks it on their own phone gets a
 * refresh token that lives 30 days from its LAST use and rotates every time it
 * is used — so the installed portal opens signed in, like any app on the phone,
 * and a device nobody opens for a month signs itself out. Without the tick
 * nothing changes: the 2-hour access token in sessionStorage is the whole
 * session, which is still the right answer on a borrowed office PC.
 *
 * Deliberately the OPPOSITE of the staff rule (doc/AUTH_SESSIONS.md, 2026-09:
 * staff sessions end two hours after sign-in, whatever). A finance officer's
 * open tab is the tenant's books; a client's phone is their own shipments and
 * invoices, opened a few times a week, and a portal that asks for a password
 * every visit is one clients stop opening. Owner's decision, portal redesign Q5.
 */
const TRUSTED_SESSION_DAYS = 30;
/** Two tabs refreshing the same token at once is a race, not a theft. */
const ROTATION_GRACE_S = 30;
/** Emailed sign-in codes: short-lived, few guesses, few per hour. */
const CODE_TTL_MIN = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_MAX_PER_HOUR = 6;

/**
 * Invite and reset lifetimes (0482).
 *
 * An INVITE reaches someone who has never used this system and may open it days
 * later — the staff-grade 30 minutes would expire on most of them and turn every
 * new client contact into a support request for the tenant. A RESET is requested
 * by someone sitting at the screen, so it keeps the short window.
 */
const INVITE_TTL_HOURS = 24 * 7;
const RESET_TTL_MIN = 30;

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function issueToken(user, { sid = null } = {}) {
  const claims = { sub: user.portal_user_id, email: user.email, typ: "portal" };
  if (sid) claims.sid = sid;
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, { expiresIn: TOKEN_TTL });
}

const safeUser = (u) => ({ portal_user_id: u.portal_user_id, email: u.email, full_name: u.full_name || null });

/** A readable device name for the "signed-in devices" list: "iPhone", "Chrome on Windows". */
function deviceLabel(userAgent) {
  const s = String(userAgent || "");
  const os = /iPhone/.test(s) ? "iPhone"
    : /iPad/.test(s) ? "iPad"
    : /Android/.test(s) ? "Android"
    : /Mac OS X|Macintosh/.test(s) ? "Mac"
    : /Windows/.test(s) ? "Windows"
    : /Linux/.test(s) ? "Linux"
    : null;
  const browser = /Edg\//.test(s) ? "Edge"
    : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari"
    : null;
  if (os && browser && !["iPhone", "iPad", "Android"].includes(os)) return `${browser} on ${os}`;
  return os || browser || null;
}

/**
 * The one place a portal sign-in turns into tokens, whichever way the person
 * proved who they are (password, emailed code, passkey, invite link).
 *
 * `trust` is the "keep me signed in" tick. With it, a `portal_session` row and a
 * refresh token; without it, exactly what this endpoint always returned.
 */
async function issueTokens(client, user, { trust = false, method = "password", userAgent = null, ip = null } = {}) {
  if (!trust) {
    return { access_token: issueToken(user), portal_user: safeUser(user), trusted: false, expires_in: TOKEN_TTL_S };
  }
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const session = await repo.insertSession(client, {
    portalUserId: user.portal_user_id,
    refreshHash: sha256(refreshToken),
    method,
    deviceLabel: deviceLabel(userAgent),
    userAgent: userAgent ? String(userAgent).slice(0, 400) : null,
    ip,
    expiresAt: new Date(Date.now() + TRUSTED_SESSION_DAYS * 86400 * 1000),
  });
  return {
    access_token: issueToken(user, { sid: session.portal_session_id }),
    refresh_token: refreshToken,
    portal_user: safeUser(user),
    trusted: true,
    expires_in: TOKEN_TTL_S,
    session_expires_in: TRUSTED_SESSION_DAYS * 86400,
  };
}

/** Verify a portal token. Throws on anything that isn't a valid portal token. */
function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
  } catch (err) {
    throw new AppError(err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN", "Invalid portal token", 401);
  }
  if (payload.typ !== "portal") throw new AppError("INVALID_TOKEN", "Not a portal token", 401);
  return payload;
}

/** Authenticate against the identity schema. Generic error — never reveal which
 *  half (email vs password) failed. */
async function login(client, { email, password, trust = false, userAgent = null, ip = null }) {
  const generic = new AppError("BAD_CREDENTIALS", "Invalid email or password", 401);
  const user = await repo.findByEmail(client, email);
  if (!user || user.status !== "ACTIVE") throw generic;
  let ok = false;
  try {
    ok = await argon2.verify(user.password_hash, password);
  } catch {
    ok = false;
  }
  if (!ok) {
    await repo.bumpFailed(client, user.portal_user_id);
    throw generic;
  }
  await repo.touchLogin(client, user.portal_user_id);
  return issueTokens(client, user, { trust, method: "password", userAgent, ip });
}

// ── Trusted-device refresh (14150) ──────────────────────────────────────────

const sessionEnded = () =>
  new AppError("SESSION_EXPIRED", "Your session has ended. Sign in again.", 401);

/**
 * Trade a refresh token for a new access token AND a new refresh token.
 *
 * Reuse detection, with a grace window. A token that was rotated away from
 * more than ROTATION_GRACE_S ago and is presented again is either a replay or a
 * copy that leaked; either way the whole session ends. Inside the window it is
 * two tabs of one browser racing, and the loser gets an access token and no
 * new refresh token — the winner already wrote the new one where both tabs
 * read it (localStorage).
 */
async function refresh(client, { refreshToken }) {
  if (!refreshToken) throw sessionEnded();
  const hash = sha256(refreshToken);
  const session = await repo.findSessionByRefresh(client, hash);
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) throw sessionEnded();

  const user = await repo.findById(client, session.portal_user_id);
  if (!user || user.status !== "ACTIVE") {
    await repo.revokeSession(client, session.portal_session_id);
    throw sessionEnded();
  }

  const inGrace = () =>
    session.rotated_at && Date.now() - new Date(session.rotated_at).getTime() <= ROTATION_GRACE_S * 1000;

  if (!session.is_current) {
    if (!inGrace()) {
      await repo.revokeSession(client, session.portal_session_id);
      logger.warn({ portal_user_id: user.portal_user_id }, "[portal] rotated refresh token presented again — session ended");
      throw sessionEnded();
    }
    await repo.touchSession(client, session.portal_session_id);
    return {
      access_token: issueToken(user, { sid: session.portal_session_id }),
      refresh_token: null,
      portal_user: safeUser(user),
      trusted: true,
      expires_in: TOKEN_TTL_S,
    };
  }

  const next = crypto.randomBytes(32).toString("base64url");
  const rotated = await repo.rotateSession(client, {
    sessionId: session.portal_session_id,
    fromHash: hash,
    toHash: sha256(next),
    expiresAt: new Date(Date.now() + TRUSTED_SESSION_DAYS * 86400 * 1000),
  });
  if (!rotated) {
    // Another tab rotated between our read and our write — the grace case.
    return {
      access_token: issueToken(user, { sid: session.portal_session_id }),
      refresh_token: null,
      portal_user: safeUser(user),
      trusted: true,
      expires_in: TOKEN_TTL_S,
    };
  }
  return {
    access_token: issueToken(user, { sid: session.portal_session_id }),
    refresh_token: next,
    portal_user: safeUser(user),
    trusted: true,
    expires_in: TOKEN_TTL_S,
    session_expires_in: TRUSTED_SESSION_DAYS * 86400,
  };
}

/** Sign out this device. Idempotent, and never an error: the person asked to be
 *  signed out, and a token we no longer recognise is already that. */
async function logout(client, { refreshToken }) {
  if (refreshToken) await repo.revokeSessionByHash(client, sha256(refreshToken));
  return { ok: true };
}

const listSessions = (client, portalUserId) => repo.listSessions(client, portalUserId);

/** For the middleware: is the session an access token was minted under still live? */
const sessionIsLive = (client, sessionId) => repo.sessionIsLive(client, sessionId);

async function revokeSession(client, { portalUserId, sessionId }) {
  const row = await repo.revokeSession(client, sessionId, portalUserId);
  if (!row) throw new AppError("NOT_FOUND", "That device is already signed out", 404);
  return { revoked: true };
}

// ── Emailed sign-in codes (14150) ───────────────────────────────────────────

/** Peppered with the user id, so the same six digits hash differently per person. */
const codeHash = (portalUserId, code) => sha256(`${portalUserId}:${code}`);

function codeEmailHtml({ name, code, tenantName }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Roboto,'Noto Sans',sans-serif">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e9f2">
    <div style="padding:28px 32px">
      <p style="margin:0 0 6px;font-size:13px;color:#84a0b0">${tenantName}</p>
      <h1 style="margin:0 0 16px;font-size:20px;color:#0b2030">Your sign-in code</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#42586a">Hi ${name}, enter this code to sign in. It works once and expires in ${CODE_TTL_MIN} minutes.</p>
      <p style="margin:0 0 22px;font-size:32px;letter-spacing:8px;font-weight:700;color:#0b2030;font-family:'JetBrains Mono',monospace">${code}</p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#84a0b0">If you did not ask for this code, you can ignore this email — nobody can sign in without it.</p>
    </div>
  </div></body></html>`;
}

/**
 * Email a six-digit code. ALWAYS answers ok, for the same reason `forgot` does:
 * the response must not reveal whether an address has an account. A code is
 * only minted for an ACTIVE user, and at most CODE_MAX_PER_HOUR an hour — past
 * that the request is silently a no-op rather than an inbox flood.
 */
async function requestCode(client, { email, ip, tenantName = "your logistics provider" }) {
  const normalized = String(email || "").trim().toLowerCase();
  const user = await repo.findByEmail(client, normalized);
  if (!user || user.status !== "ACTIVE") return { ok: true };
  if ((await repo.countRecentLoginCodes(client, user.portal_user_id, 60)) >= CODE_MAX_PER_HOUR) {
    logger.warn({ portal_user_id: user.portal_user_id }, "[portal] sign-in code limit reached");
    return { ok: true };
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await repo.retireLoginCodes(client, user.portal_user_id);
  await repo.insertLoginCode(client, {
    portalUserId: user.portal_user_id,
    codeHash: codeHash(user.portal_user_id, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000),
    ip,
  });
  const firstName = user.full_name ? String(user.full_name).trim().split(/\s+/)[0] : "there";
  try {
    await emailService.send(client, {
      to: user.email,
      subject: `${code} is your sign-in code`,
      html: codeEmailHtml({ name: firstName, code, tenantName }),
      text: `Hi ${firstName},\n\nYour sign-in code is ${code}. It works once and expires in ${CODE_TTL_MIN} minutes.\n\nIf you did not ask for it, ignore this email.`,
      purpose: "NOTIFICATIONS",
      moduleKey: MODULE,
      sendPoint: "portal.invite",
    });
  } catch (err) {
    logger.error({ err, portal_user_id: user.portal_user_id }, "[portal] sign-in code email failed to send");
  }
  return { ok: true };
}

/**
 * Check a code and sign in. One generic error for every failure — wrong code,
 * expired, used, too many guesses, unknown email — so the endpoint cannot be
 * used to learn which of those it was.
 */
async function verifyCode(client, { email, code, trust = false, userAgent = null, ip = null }) {
  const invalid = () => new AppError("INVALID_CODE", "That code is not valid. Check the latest email, or ask for a new code.", 401);
  const normalized = String(email || "").trim().toLowerCase();
  const user = await repo.findByEmail(client, normalized);
  if (!user || user.status !== "ACTIVE") throw invalid();
  const row = await repo.latestLoginCode(client, user.portal_user_id);
  if (!row || row.attempts >= CODE_MAX_ATTEMPTS) throw invalid();

  const expected = Buffer.from(row.code_hash, "hex");
  const actual = Buffer.from(codeHash(user.portal_user_id, String(code || "").trim()), "hex");
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!match) {
    await repo.bumpLoginCodeAttempts(client, row.portal_login_code_id);
    throw invalid();
  }
  // Single use, and the WHERE on used_at makes two simultaneous submissions of
  // the same code produce one session, not two.
  if (!(await repo.useLoginCode(client, row.portal_login_code_id))) throw invalid();
  await repo.touchLogin(client, user.portal_user_id);
  return issueTokens(client, user, { trust, method: "code", userAgent, ip });
}

async function createUser(client, { email, password, fullName }) {
  // SEC H6. This was `String(password).length < 8` — no complexity, no breach
  // check — while staff accounts have gone through assertStrongPassword (12
  // chars, complexity, email-local-part rejection, HIBP) all along. "password"
  // and "12345678" both passed.
  //
  // The weakness was inverted relative to exposure: a portal account belongs to
  // an external client contact, investor or auditor, and it exposes that
  // client's dossiers, invoices and receivables ageing — or, for an auditor
  // grant, the tenant's full financial statements and general-ledger trail.
  // Those are the accounts least likely to have a password manager behind them.
  await passwordPolicy.assertStrongPassword(password, { email });
  const existing = await repo.findByEmail(client, email);
  if (existing) throw new AppError("EMAIL_TAKEN", "A portal user with that email already exists", 409);
  const password_hash = await argon2.hash(password, { type: argon2.argon2id });
  return repo.insert(client, { email, passwordHash: password_hash, fullName });
}

async function setPassword(client, { id, password }) {
  // SEC H6. Load the target first so the policy can apply its
  // email-local-part rule; a 404 for an unknown id is the same as before.
  const target = await repo.findById(client, id);
  if (!target) throw new AppError("NOT_FOUND", "Portal user not found", 404);
  await passwordPolicy.assertStrongPassword(password, { email: target.email });
  const password_hash = await argon2.hash(password, { type: argon2.argon2id });
  const row = await repo.setPassword(client, id, password_hash);
  if (!row) throw new AppError("NOT_FOUND", "Portal user not found", 404);
  // A password set by staff is usually "we think this account was used by
  // someone else" — every remembered device signs in again.
  await repo.revokeAllSessions(client, id);
  return row;
}

async function setStatus(client, { id, status }) {
  if (!["ACTIVE", "DISABLED"].includes(status)) throw new AppError("BAD_STATUS", "status must be ACTIVE/DISABLED", 422);
  const row = await repo.setStatus(client, id, status);
  if (!row) throw new AppError("NOT_FOUND", "Portal user not found", 404);
  // `refresh` refuses a disabled user anyway; revoking here makes the device
  // list say so too, instead of showing sessions that can no longer do anything.
  if (status === "DISABLED") await repo.revokeAllSessions(client, id);
  return row;
}

const listUsers = (client) => repo.list(client);
const usersByEmails = (client, emails) => (emails.length ? repo.usersByEmails(client, emails) : []);
const getById = (client, id) => repo.findById(client, id);

// ── Invitations + recovery (0482) ───────────────────────────────────────────

function inviteEmailHtml({ name, link, tenantName, isReset }) {
  const heading = isReset ? "Reset your password" : `You've been given access to ${tenantName}`;
  const lead = isReset
    ? "Use the link below to choose a new password."
    : `${tenantName} has given you access to their client portal, where you can follow your shipments, documents and invoices.`;
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Roboto,'Noto Sans',sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e9f2">
    <div style="padding:28px 32px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0b2030">${heading}</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#42586a">Hi ${name}, ${lead}</p>
      <p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#F5821F;color:#fff;text-decoration:none;font-weight:600;font-size:14px">${isReset ? "Choose a new password" : "Set your password"}</a></p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#84a0b0">This link can only be used once${isReset ? `, and expires in ${RESET_TTL_MIN} minutes` : ` and expires in ${INVITE_TTL_HOURS / 24} days`}. If you weren't expecting it, you can ignore this email.</p>
    </div>
  </div></body></html>`;
}

async function sendInviteEmail(client, { to, name, token, origin, purpose, tenantName }) {
  const isReset = purpose === "RESET";
  const base = origin || `https://app.${config.APP_BASE_DOMAIN}`;
  // Consumed by the portal SPA route, NOT the staff one — a portal user has no
  // app_user row, so the staff reset screen would reject them confusingly.
  // `/portal`, the external portal's own prefix (the staff grant screen lives
  // at `/settings/portal-access`, so there is no overlap).
  const link = `${base}/portal/set-password?token=${encodeURIComponent(token)}`;
  const firstName = name ? String(name).trim().split(/\s+/)[0] : "there";
  const text = isReset
    ? `Hi ${firstName},\n\nUse the link below within ${RESET_TTL_MIN} minutes to choose a new password (single use):\n\n${link}`
    : `Hi ${firstName},\n\n${tenantName} has given you access to their client portal. Set your password using the link below (single use, valid for ${INVITE_TTL_HOURS / 24} days):\n\n${link}`;
  await emailService.send(client, {
    to,
    subject: isReset ? "Reset your portal password" : `Your access to ${tenantName}`,
    html: inviteEmailHtml({ name: firstName, link, tenantName, isReset }),
    text,
    purpose: "NOTIFICATIONS",
    moduleKey: MODULE,
    // One send point for both halves: the registry has `portal.invite`, and a
    // portal password reset goes to the same audience from the same address.
    // Splitting them would mean a registry row a tenant could bind and we would
    // then have to keep two bindings in step for one conversation.
    sendPoint: "portal.invite",
  });
}

/**
 * Issue a one-time link. Shared by the staff invite and the self-service reset,
 * because they differ only in lifetime and wording.
 */
async function issueLink(client, { user, purpose, ip }) {
  const token = crypto.randomBytes(32).toString("hex");
  const ttlMs = purpose === "RESET" ? RESET_TTL_MIN * 60 * 1000 : INVITE_TTL_HOURS * 3600 * 1000;
  await repo.invalidateInvites(client, user.portal_user_id); // one live link at a time
  await repo.createInvite(client, {
    portalUserId: user.portal_user_id,
    tokenHash: sha256(token),
    purpose,
    expiresAt: new Date(Date.now() + ttlMs),
    ip,
  });
  return { token };
}

/**
 * Staff action: make sure a login EXISTS for this email and send the set-password
 * link. This is what closes the grant-with-no-login gap.
 *
 * Create-or-find, deliberately: a client contact can hold a CLIENT grant and an
 * AUDITOR grant, or be re-granted after a revoke, and neither should fail because
 * the login already exists. A brand-new row gets a random unusable password —
 * `password_hash` is NOT NULL and nobody, including staff, should know a value
 * that would let them sign in as an external party.
 *
 * Returns whether the mail actually went out, so the UI can say "invite not sent
 * — resend" rather than implying success. A mail failure must not lose the login
 * or the token; both stay valid for a resend.
 */
async function inviteUser(client, { email, fullName, ip, origin, tenantName = "your logistics provider" }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new AppError("EMAIL_REQUIRED", "email is required", 422);

  let user = await repo.findByEmail(client, normalized);
  let created = false;
  if (!user) {
    const unusable = await argon2.hash(crypto.randomBytes(32).toString("hex"), { type: argon2.argon2id });
    user = await repo.insert(client, { email: normalized, passwordHash: unusable, fullName });
    created = true;
  } else if (user.status !== "ACTIVE") {
    // Re-inviting a disabled login reactivates it — otherwise the invite lands
    // and the sign-in silently fails with the generic credentials error.
    await repo.setStatus(client, user.portal_user_id, "ACTIVE");
  }

  const { token } = await issueLink(client, { user, purpose: "INVITE", ip });

  let emailed = true;
  try {
    await sendInviteEmail(client, { to: normalized, name: fullName || user.full_name, token, origin, purpose: "INVITE", tenantName });
  } catch (err) {
    emailed = false;
    logger.error({ err, email: normalized }, "[portal] invite email failed to send");
  }
  return { portal_user_id: user.portal_user_id, email: normalized, created, emailed };
}

/**
 * Self-service reset. Always returns ok — the response must not reveal whether an
 * email is registered, exactly as the staff flow does. A token is only minted for
 * an ACTIVE user.
 */
async function requestReset(client, { email, ip, origin, tenantName }) {
  const normalized = String(email || "").trim().toLowerCase();
  const user = await repo.findByEmail(client, normalized);
  if (user && user.status === "ACTIVE") {
    const { token } = await issueLink(client, { user, purpose: "RESET", ip });
    try {
      await sendInviteEmail(client, { to: user.email, name: user.full_name, token, origin, purpose: "RESET", tenantName });
    } catch (err) {
      logger.error({ err, portal_user_id: user.portal_user_id }, "[portal] reset email failed to send");
    }
  }
  return { ok: true };
}

/**
 * Consume a link and set the password. Serves both purposes — the token itself
 * carries which one it was.
 *
 * The error is deliberately identical for expired, already-used and unknown
 * tokens: distinguishing them tells an attacker which guesses were once real.
 */
async function acceptInvite(client, { token, password, trust = false, userAgent = null, ip = null }) {
  const invalid = () => new AppError("INVALID_INVITE", "This link is invalid or has expired. Ask for a new one.", 400);
  if (!token) throw invalid();

  const row = await repo.findInviteByHash(client, sha256(token));
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) throw invalid();

  // SEC H6. The policy check moved BELOW the token lookup deliberately: it
  // needs the invitee's email for the local-part rule, and that only exists
  // once the invite resolves. Ordering is safe — an invalid token still fails
  // first with the same generic error, so this leaks nothing about which
  // tokens exist.
  await passwordPolicy.assertStrongPassword(password, { email: row.email });

  const user = await repo.findById(client, row.portal_user_id);
  if (!user || user.status !== "ACTIVE") throw invalid();

  const password_hash = await argon2.hash(password, { type: argon2.argon2id });
  await repo.setPassword(client, user.portal_user_id, password_hash);
  await repo.markInviteUsed(client, row.invite_id);
  // A reset means the old password is in doubt, so every device that was kept
  // signed in with it signs in again — except the one being signed in now.
  if (row.purpose === "RESET") await repo.revokeAllSessions(client, user.portal_user_id);
  // Signed in immediately: the alternative is bouncing someone who has just
  // proved control of the mailbox back to a login form to retype what they typed.
  return issueTokens(client, user, { trust, method: "invite", userAgent, ip });
}

const inviteStatus = (client, portalUserId) => repo.inviteStatus(client, portalUserId);
const latestInvites = (client, portalUserIds) => repo.latestInvites(client, portalUserIds);

module.exports = {
  login, verifyToken, createUser, setPassword, setStatus, listUsers, usersByEmails, getById,
  inviteUser, requestReset, acceptInvite, inviteStatus, latestInvites,
  issueTokens, refresh, logout, listSessions, sessionIsLive, revokeSession, requestCode, verifyCode,
  TRUSTED_SESSION_DAYS,
};
