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
const MODULE = "MOD-67";

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

function issueToken(user) {
  return jwt.sign({ sub: user.portal_user_id, email: user.email, typ: "portal" }, config.JWT_ACCESS_SECRET, {
    expiresIn: TOKEN_TTL,
  });
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
async function login(client, { email, password }) {
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
  return {
    access_token: issueToken(user),
    portal_user: { portal_user_id: user.portal_user_id, email: user.email, full_name: user.full_name },
  };
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
  return row;
}

async function setStatus(client, { id, status }) {
  if (!["ACTIVE", "DISABLED"].includes(status)) throw new AppError("BAD_STATUS", "status must be ACTIVE/DISABLED", 422);
  const row = await repo.setStatus(client, id, status);
  if (!row) throw new AppError("NOT_FOUND", "Portal user not found", 404);
  return row;
}

const listUsers = (client) => repo.list(client);
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
async function acceptInvite(client, { token, password }) {
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
  // Signed in immediately: the alternative is bouncing someone who has just
  // proved control of the mailbox back to a login form to retype what they typed.
  return { access_token: issueToken(user), portal_user: user };
}

const inviteStatus = (client, portalUserId) => repo.inviteStatus(client, portalUserId);

module.exports = {
  login, verifyToken, createUser, setPassword, setStatus, listUsers, getById,
  inviteUser, requestReset, acceptInvite, inviteStatus,
};
